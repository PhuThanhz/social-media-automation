/**
 * TOOLZUTTER DESKTOP RUNNER
 * Khởi chạy đồng bộ cả 2 dịch vụ ngầm cho Desktop App:
 * 1. Desktop SQLite Bridge (Cổng 8081 - Lưu trữ tài khoản, hàng đợi, chiến dịch)
 * 2. Playwright Worker (Cổng 3001 - Tự động hóa đăng bài, cào video, buff tương tác)
 */

const { fork } = require('child_process');
const path = require('path');

console.log('========================================================');
console.log('⚡ [ToolZutter Desktop Runner] Đang khởi động tiến trình nội bộ...');
console.log('========================================================');

// 1. Khởi động Desktop SQLite API Bridge (Port 8081)
const bridgeProcess = fork(path.join(__dirname, 'desktop-bridge.js'), [], {
  env: { ...process.env, DESKTOP_API_PORT: '8081' }
});

bridgeProcess.on('error', (err) => {
  console.error('[Desktop Bridge Error]:', err);
});

// 2. Khởi động Playwright Worker (Port 3001)
const workerProcess = fork(path.join(__dirname, 'server.js'), [], {
  env: { ...process.env, PORT: '3001' }
});

workerProcess.on('error', (err) => {
  console.error('[Playwright Worker Error]:', err);
});

// Xử lý dừng khi tắt App
function cleanup() {
  console.log('\n🛑 Đang dừng các tiến trình chạy ngầm...');
  try { bridgeProcess.kill(); } catch {}
  try { workerProcess.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
