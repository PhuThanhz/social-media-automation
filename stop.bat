@echo off
chcp 65001 >nul
title TOOLZUTTER 3.3 - DỪNG TẤT CẢ DỊCH VỤ
color 0C

echo ==============================================================================
echo       🛑 DỪNG TẤT CẢ DỊCH VỤ TOOLZUTTER 3.3 (PORTS 3000, 3001, 8081)
echo ==============================================================================
echo.

:: Dừng tiến trình port 3000 (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [*] Dừng Frontend trên Port 3000 (PID: %%a)...
    taskkill /F /T /PID %%a >nul 2>&1
)

:: Dừng tiến trình port 3001 (Worker)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do (
    echo [*] Dừng Worker trên Port 3001 (PID: %%a)...
    taskkill /F /T /PID %%a >nul 2>&1
)

:: Dừng tiến trình port 8081 (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8081 ^| findstr LISTENING') do (
    echo [*] Dừng Backend trên Port 8081 (PID: %%a)...
    taskkill /F /T /PID %%a >nul 2>&1
)

:: Dọn dẹp các tiến trình Chromium/Playwright mồ côi (nếu có)
taskkill /F /IM "chrome.exe" /FI "WINDOWTITLE eq data:*" >nul 2>&1
taskkill /F /IM "chromium.exe" >nul 2>&1

echo.
echo [OK] Đã giải phóng hoàn tất các cổng 3000, 3001, 8081 và dọn dẹp RAM!
timeout /t 2 /nobreak >nul
exit /b 0
