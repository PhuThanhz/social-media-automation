/**
 * Địa chỉ backend/worker lúc chạy.
 * - Bản web: như cũ (biến VITE_* hoặc cùng hostname, cổng 8081/3001).
 * - Bản Desktop: app Tauri tự khởi động backend/worker trên 127.0.0.1 và cấp token phiên;
 *   token được gắn vào mọi request tới hai địa chỉ đó (axios + fetch), link tải file dùng ?st=.
 * Phải gọi initRuntime() trước khi import App (các module đọc giá trị ngay lúc import).
 */
import axios from 'axios';

const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

export const runtime = {
  backendBase: (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/?$/, '') || `http://${host}:8081`,
  workerBase: (import.meta.env.VITE_WORKER_BASE_URL as string | undefined) || `http://${host}:3001`,
  sessionToken: null as string | null,
};

export const apiBaseUrl = () => `${runtime.backendBase}/api`;

const isLocalService = (url: string) =>
  url.startsWith(runtime.backendBase) || url.startsWith(runtime.workerBase);

/** Link mở bằng thẻ <a>/window.open không gửi được header → thêm ?st= */
export function withSessionToken(url: string): string {
  if (!runtime.sessionToken || !isLocalService(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(runtime.sessionToken)}`;
}

export function initRuntime(cfg: { apiBase: string; workerBase: string; token: string | null }) {
  runtime.backendBase = cfg.apiBase.replace(/\/$/, '');
  runtime.workerBase = cfg.workerBase.replace(/\/$/, '');
  runtime.sessionToken = cfg.token;
  if (!cfg.token) return;

  const token = cfg.token;
  // Đăng nhập trong app (JWT) — chỉ gửi cho backend, không gửi ra ngoài
  const bearer = () => localStorage.getItem('access_token');
  // axios mặc định (các trang gọi worker trực tiếp); instance `api` gắn riêng trong config/axios.ts
  axios.interceptors.request.use((config) => {
    const url = axios.getUri(config);
    if (isLocalService(url)) config.headers.set('X-Session-Token', token);
    if (url.startsWith(runtime.backendBase) && bearer() && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${bearer()}`);
    }
    return config;
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isLocalService(url)) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('X-Session-Token', token);
    if (url.startsWith(runtime.backendBase) && bearer() && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${bearer()}`);
    }
    return nativeFetch(input, { ...init, headers });
  };
}

export function sessionHeaders(): Record<string, string> {
  return runtime.sessionToken ? { 'X-Session-Token': runtime.sessionToken } : {};
}
