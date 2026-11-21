/**
 * Bản quyền chỉ áp dụng cho bản Desktop (Tauri).
 * Toàn bộ kích hoạt, kiểm tra chữ ký token và lưu trữ nằm trong Rust (src-tauri/src/license.rs);
 * file này chỉ gọi các command và hiển thị kết quả.
 */

export interface LicenseInfo {
  key: string;
  hwid: string;
  client: string;
  maxAccounts: number | null;
  /** Unix giây, null = vĩnh viễn */
  licenseExp: number | null;
  /** Unix giây: hết hạn dùng offline nếu không ping được server */
  exp: number;
  iat: number;
}

export interface LicenseState {
  valid: boolean;
  revoked: boolean;
  reason: string | null;
  info: LicenseInfo | null;
  hwid: string | null;
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

class LicenseService {
  async getHWID(): Promise<string> {
    if (!isTauri()) return 'Chỉ có trên bản Desktop';
    try {
      return await invoke<string>('get_device_hwid');
    } catch (e) {
      return String(e);
    }
  }

  /** Trạng thái từ token đã lưu, không gọi mạng */
  status(): Promise<LicenseState> {
    return invoke<LicenseState>('license_status');
  }

  /** Ping server làm mới token; mất mạng thì dùng token cũ tới hết hạn offline */
  refresh(): Promise<LicenseState> {
    return invoke<LicenseState>('license_refresh');
  }

  async activate(key: string): Promise<{ success: boolean; state?: LicenseState; message?: string }> {
    try {
      const state = await invoke<LicenseState>('license_activate', { key });
      return { success: true, state };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  }

  /** Rust phát sự kiện này trước khi tự đóng app khi key bị khóa/hết hạn */
  async onInvalid(cb: (state: LicenseState) => void): Promise<() => void> {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<LicenseState>('license-invalid', (e) => cb(e.payload));
  }

  logout(): Promise<void> {
    return invoke('license_logout');
  }

  kill(): Promise<void> {
    return invoke('kill_application');
  }
}

export const licenseService = new LicenseService();
