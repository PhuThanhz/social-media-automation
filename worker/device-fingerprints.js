/**
 * device-fingerprints.js
 * Bộ giả lập danh tính thiết bị phần cứng & User-Agent đa dạng
 * Chống Meta Fingerprinting gom nhóm các Via vào chung 1 máy tính
 */

const DEVICE_PROFILES = [
  {
    name: 'MacBook Pro M3 (macOS Sonoma)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    vendor: 'Google Inc.',
  },
  {
    name: 'Windows 11 PC (Chrome 133)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    vendor: 'Google Inc.',
  },
  {
    name: 'Dell XPS 15 (Windows 11 Pro)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    vendor: 'Google Inc.',
  },
  {
    name: 'iMac 24-inch M3 (macOS Sonoma)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    vendor: 'Apple Computer, Inc.',
  },
  {
    name: 'iPad Pro 12.9 (iPadOS Desktop Mode)',
    type: 'TABLET',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    viewport: { width: 1366, height: 1024 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    platform: 'MacIntel',
    vendor: 'Apple Computer, Inc.',
  },
  {
    name: 'ThinkPad X1 Carbon (Linux Ubuntu)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
  },
];

/**
 * Trả về cấu hình giả lập thiết bị ổn định theo UID (cùng 1 UID luôn dùng 1 loại thiết bị quen thuộc)
 */
function getDeviceForUid(uid = '') {
  if (!uid) {
    return DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];
  }
  // Hash chuỗi UID để cố định thiết bị cho từng nick (giống người thật dùng 1 điện thoại/máy tính quen thuộc)
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % DEVICE_PROFILES.length;
  return DEVICE_PROFILES[index];
}

/**
 * Áp dụng cấu hình và script ẩn danh cho context
 */
async function applyFingerprintToContext(context, profile) {
  await context.addInitScript((prof) => {
    // 1. Ẩn dấu vết Playwright/Selenium webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // 2. Mock vendor & platform
    if (prof.vendor) {
      Object.defineProperty(navigator, 'vendor', {
        get: () => prof.vendor,
      });
    }
    if (prof.platform) {
      Object.defineProperty(navigator, 'platform', {
        get: () => prof.platform,
      });
    }

    // 3. Mock languages Tiếng Việt & Tiếng Anh
    Object.defineProperty(navigator, 'languages', {
      get: () => ['vi-VN', 'vi', 'en-US', 'en'],
    });

    // 4. Mock window.chrome cho trình duyệt nhân Chromium
    if (!window.chrome) {
      window.chrome = {
        runtime: {},
        loadTimes: () => {},
        csi: () => {},
      };
    }
  }, profile);
}

module.exports = {
  DEVICE_PROFILES,
  getDeviceForUid,
  applyFingerprintToContext,
};
