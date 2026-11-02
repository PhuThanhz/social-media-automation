import axios from 'axios';
import { apiBaseUrl, sessionHeaders } from './runtime';

const api = axios.create({
  baseURL: apiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 180000, // 180 giây (3 phút) — đủ cho các thao tác Playwright nhiều bước (đăng -> sửa 3 chấm -> cmt)
});

// Interceptor request: đính kèm JWT token
api.interceptors.request.use((config) => {
  Object.assign(config.headers, sessionHeaders()); // token phiên của bản Desktop
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor response: xử lý lỗi 401 (token hết hạn) và lỗi mạng
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      // Chỉ đăng xuất khi phiên đăng nhập hệ thống hết hạn, không đăng xuất khi cookie MXH bên thứ 3 hết hạn
      const isThirdPartyOperation = url.includes('/connections') || url.includes('/validate-cookie') || url.includes('/join-group');
      if (!isThirdPartyOperation) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        if (window.location.pathname !== '/login' && window.location.pathname !== '/') {
          window.location.href = '/login';
        }
      }
    }
    // Bổ sung thông báo lỗi rõ ràng hơn cho Network Error
    if (!error.response && error.code === 'ERR_NETWORK') {
      error.message = 'Không kết nối được máy chủ. Vui lòng kiểm tra backend đang chạy.';
    }
    if (error.code === 'ECONNABORTED') {
      error.message = 'Yêu cầu quá thời gian chờ. Thử lại sau.';
    }
    return Promise.reject(error);
  }
);

export default api;
