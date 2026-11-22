import React, { useCallback, useRef, useState } from 'react';
import { Button, Form, Input, Spin } from 'antd';
import { LicenseGuardModal } from './LicenseGuardModal';

export interface DesktopServices {
  apiBase: string;
  workerBase: string;
  token: string | null;
}

interface ServicesStatus {
  phase: 'idle' | 'starting' | 'ready' | 'failed';
  message: string;
  warning: string | null;
  apiBase: string | null;
  workerBase: string | null;
  token: string | null;
}

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd);
}

/**
 * Màn hình khởi động bản Desktop: xác thực bản quyền → app khởi động backend + worker → mở giao diện chính.
 * Backend/worker chỉ được chạy sau khi bản quyền hợp lệ.
 */
const DesktopBoot: React.FC<{ onReady: (cfg: DesktopServices, warning: string | null) => void }> = ({ onReady }) => {
  const [message, setMessage] = useState<string>('Đang kiểm tra bản quyền...');
  const [error, setError] = useState<string | null>(null);
  // Lần đầu mở app trên máy này: chưa có người dùng → tạo tài khoản Chủ
  const [setupFor, setSetupFor] = useState<{ cfg: DesktopServices; warning: string | null; client?: string } | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savingSetup, setSavingSetup] = useState(false);
  const starting = useRef(false);

  const backendFetch = (cfg: DesktopServices, path: string, init?: RequestInit) =>
    fetch(`${cfg.apiBase}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(cfg.token ? { 'X-Session-Token': cfg.token } : {}) },
    });

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setError(null);
    try {
      let status = await invoke<ServicesStatus>('services_start');
      while (status.phase === 'starting') {
        setMessage(status.message || 'Đang khởi động dịch vụ...');
        await new Promise((r) => setTimeout(r, 700));
        status = await invoke<ServicesStatus>('services_status');
      }
      if (status.phase === 'ready' && status.apiBase && status.workerBase) {
        const cfg = { apiBase: status.apiBase, workerBase: status.workerBase, token: status.token };
        const setup = await backendFetch(cfg, '/desktop/setup-status').then((r) => r.json()).catch(() => null);
        if (setup?.needsSetup) {
          // Token đăng nhập cũ (nếu có) không còn giá trị với máy chưa có người dùng
          localStorage.removeItem('access_token');
          setSetupFor({ cfg, warning: status.warning, client: setup.plan?.client });
          return;
        }
        onReady(cfg, status.warning);
        return;
      }
      setError(status.message || 'Không khởi động được dịch vụ');
    } catch (e) {
      setError(String(e));
    }
    starting.current = false;
  }, [onReady]);

  const submitSetup = async (values: { displayName?: string; login: string; password: string }) => {
    if (!setupFor) return;
    setSavingSetup(true);
    setSetupError(null);
    try {
      const res = await backendFetch(setupFor.cfg, '/desktop/setup', { method: 'POST', body: JSON.stringify(values) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.accessToken) throw new Error(data.message || 'Không tạo được tài khoản');
      localStorage.setItem('access_token', data.accessToken);
      onReady(setupFor.cfg, setupFor.warning);
    } catch (e) {
      setSetupError(String((e as Error).message || e));
    } finally {
      setSavingSetup(false);
    }
  };

  if (setupFor) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#080d16] text-slate-200 p-6">
        <div className="w-full max-w-sm space-y-4">
          <div>
            <div className="text-lg font-semibold text-white">Tạo tài khoản chủ</div>
            <div className="text-sm text-slate-400 mt-1">
              {setupFor.client ? `Bản quyền: ${setupFor.client}. ` : ''}Tài khoản này quản lý người dùng khác trên máy. Hãy ghi nhớ mật khẩu.
            </div>
          </div>
          <Form layout="vertical" requiredMark={false} onFinish={submitSetup}>
            <Form.Item name="displayName" label={<span className="text-slate-300">Tên hiển thị</span>}>
              <Input placeholder="VD: Anh Minh" />
            </Form.Item>
            <Form.Item
              name="login"
              label={<span className="text-slate-300">Tên đăng nhập</span>}
              rules={[{ required: true, pattern: /^[a-zA-Z0-9._-]{3,50}$/, message: '3-50 ký tự: chữ cái, số, . _ -' }]}
            >
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label={<span className="text-slate-300">Mật khẩu</span>} rules={[{ required: true, min: 6, message: 'Tối thiểu 6 ký tự' }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label={<span className="text-slate-300">Nhập lại mật khẩu</span>}
              dependencies={['password']}
              rules={[
                { required: true, message: 'Nhập lại mật khẩu' },
                ({ getFieldValue }) => ({
                  validator: (_, v) => (v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('Mật khẩu không khớp'))),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            {setupError && <div className="text-sm text-red-400 mb-3">{setupError}</div>}
            <Button type="primary" htmlType="submit" block loading={savingSetup}>Tạo tài khoản và vào ứng dụng</Button>
          </Form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[#080d16] text-slate-200 p-6">
      <LicenseGuardModal onAuthorized={() => start()} />
      {error ? (
        <div className="max-w-xl w-full space-y-3">
          <div className="text-base font-semibold text-white">Không khởi động được PhuSocial Pro</div>
          <pre className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-3 whitespace-pre-wrap max-h-80 overflow-auto">{error}</pre>
          <div className="text-xs text-slate-500">Nhật ký chi tiết nằm trong thư mục dữ liệu của ứng dụng, mục logs/.</div>
          <Button type="primary" onClick={() => start()}>Thử lại</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Spin size="large" />
          <div className="text-sm text-slate-400">{message}</div>
        </div>
      )}
    </div>
  );
};

export default DesktopBoot;
