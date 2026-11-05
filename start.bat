@echo off
chcp 65001 >nul
echo ==========================================================
echo    🚀 KHỞI ĐỘNG HỆ THỐNG TOOLZUTTER 3.3 (WINDOWS)
echo ==========================================================

set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

echo [1/3] Chuẩn bị Worker & Playwright...
cd /d "%PROJECT_DIR%worker"
if not exist node_modules (
    echo Đang cài đặt thư viện worker...
    call npm install
)
echo Tải Chromium cho Playwright nếu chưa có...
call npx playwright install chromium
start "TOOLZUTTER Worker (Port 3001)" cmd /k "node server.js"

echo [2/3] Chuẩn bị Backend Spring Boot (Port 8081)...
cd /d "%PROJECT_DIR%backend"
if exist target\saas-0.0.1-SNAPSHOT.jar (
    start "TOOLZUTTER Backend (Port 8081)" cmd /k "java -jar target\saas-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev"
) else (
    start "TOOLZUTTER Backend (Port 8081)" cmd /k "mvn spring-boot:run -Dspring-boot.run.profiles=dev"
)

echo [3/3] Chuẩn bị Frontend (Port 5173)...
cd /d "%PROJECT_DIR%frontend"
if not exist node_modules (
    echo Đang cài đặt thư viện frontend...
    call npm install
)

echo ----------------------------------------------------------
echo 🌐 Mở trình duyệt truy cập: http://localhost:5173
echo    - Email:    admin@gmail.com
echo    - Mật khẩu: 123456
echo ----------------------------------------------------------

call npm run dev

