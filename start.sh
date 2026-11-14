#!/bin/bash
# ==============================================================================
# TOOLZUTTER - SOCIAL MEDIA AUTOMATION SAAS (STARTUP SCRIPT)
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

echo "=========================================================="
echo "   🚀 KHỞI ĐỘNG HỆ THỐNG TOOLZUTTER 3.3 SAAS PLATFORM"
echo "=========================================================="

# 1. Kiểm tra môi trường
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Lỗi: Chưa cài đặt Node.js! Vui lòng cài Node 18+ (https://nodejs.org)."
    exit 1
fi

if ! command -v java >/dev/null 2>&1; then
    echo "❌ Lỗi: Chưa cài đặt Java! Vui lòng cài Java JDK 17 hoặc 21."
    exit 1
fi

# 2. Chuẩn bị Worker & Playwright
echo "📦 [1/3] Chuẩn bị Worker & Trình duyệt Playwright..."
cd "$PROJECT_DIR/worker" || exit 1
if [ ! -d "node_modules" ]; then
    echo "📥 Đang cài đặt thư viện worker..."
    npm install
fi

# Đảm bảo có Chromium
if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo "📥 Đang tải Chromium cho Playwright (chỉ chạy 1 lần)..."
    npx playwright install chromium
fi

# 3. Chuẩn bị Frontend
echo "📦 [2/3] Chuẩn bị Giao diện Frontend..."
cd "$PROJECT_DIR/frontend" || exit 1
if [ ! -d "node_modules" ]; then
    echo "📥 Đang cài đặt thư viện frontend..."
    npm install
fi

# 4. Khởi chạy các dịch vụ
echo "🚀 [3/3] Bắt đầu khởi động các dịch vụ..."

# Chạy Worker 1 (Port 3001 - Đăng bài & Cron)
cd "$PROJECT_DIR/worker" || exit 1
nohup node server.js > worker.log 2>&1 &
WORKER_PID=$!
echo "   ✅ Worker Engine 1 đã bật (PID: $WORKER_PID, Port: 3001)"

# Chạy Worker 2 (Port 3002 - Cào bài & Xử lý song song)
PORT=3002 nohup node server.js > worker_3002.log 2>&1 &
WORKER2_PID=$!
echo "   ✅ Worker Engine 2 đã bật (PID: $WORKER2_PID, Port: 3002 - Cào song song)"

# Chạy Backend Spring Boot (Port 8081)
cd "$PROJECT_DIR/backend" || exit 1
if [ -f "target/saas-0.0.1-SNAPSHOT.jar" ]; then
    nohup java -jar target/saas-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev > backend.log 2>&1 &
    BACKEND_PID=$!
    echo "   ✅ Backend Spring Boot đã bật từ JAR (PID: $BACKEND_PID, Port: 8081)"
else
    echo "   ⏳ Đang khởi động Backend qua Maven..."
    nohup mvn spring-boot:run -Dspring-boot.run.profiles=dev > backend.log 2>&1 &
    BACKEND_PID=$!
    echo "   ✅ Backend Spring Boot đang chạy qua Maven (PID: $BACKEND_PID, Port: 8081)"
fi

# Chạy Frontend (Port 5173)
cd "$PROJECT_DIR/frontend" || exit 1
echo "   ✅ Frontend Vite đang chạy (Port: 5173)..."
echo "----------------------------------------------------------"
echo "🌐 Đăng nhập tại: http://localhost:5173"
echo "   - Email:    admin@gmail.com"
echo "   - Mật khẩu: 123456"
echo "----------------------------------------------------------"
echo "💡 Nhấn Ctrl + C để dừng giao diện Frontend."

npm run dev

