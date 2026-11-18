@echo off
chcp 65001 >nul
title TOOLZUTTER 3.3 SAAS PLATFORM - ALL IN ONE LAUNCHER
color 0B

echo ==============================================================================
echo       🚀 KHỞI ĐỘNG HỆ THỐNG TOOLZUTTER 3.3 SAAS AUTOMATION PLATFORM
echo ==============================================================================
echo.

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

:: 1. Tự động tìm và cấu hình Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
        echo [OK] Đã tìm thấy Node.js tại C:\Program Files\nodejs
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
        echo [OK] Đã tìm thấy Node.js tại C:\Program Files (x86)\nodejs
    ) else if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
        echo [OK] Đã tìm thấy Node.js tại %LOCALAPPDATA%\Programs\node
    ) else (
        echo [X] Lỗi: Chưa tìm thấy Node.js trên máy!
        echo Vui lòng cài đặt Node.js LTS từ https://nodejs.org
        pause
        exit /b 1
    )
) else (
    echo [OK] Node.js: Đã sẵn sàng
)

:: 2. Tự động tìm và cấu hình Java 17/21 / JDK cho Spring Boot & Maven Wrapper
if not defined JAVA_HOME (
    for /d %%D in ("C:\Program Files\Microsoft\jdk-21*" "C:\Program Files\Java\jdk-21*" "C:\Program Files\Eclipse Adoptium\jdk-21*" "C:\Program Files\BellSoft\LibericaJDK-21*" "C:\Program Files\Java\jdk-17*" "C:\Program Files\Microsoft\jdk-17*") do (
        if exist "%%D\bin\java.exe" if not defined JAVA_HOME set "JAVA_HOME=%%D"
    )
)
if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo [OK] Java JDK: %JAVA_HOME%
) else (
    where java >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Java: Đã sẵn sàng trong PATH
    ) else (
        echo [X] Lỗi: Chưa tìm thấy Java JDK (17 hoặc 21) trên máy!
        echo Vui lòng cài đặt OpenJDK 17 hoặc 21.
        pause
        exit /b 1
    )
)

:: 3. Kiểm tra dịch vụ cơ sở dữ liệu MySQL (Port 3306)
netstat -ano | findstr :3306 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] MySQL chưa bật trên cổng 3306. Đang thử khởi động dịch vụ Windows...
    net start MySQL84 >nul 2>&1 || net start MySQL >nul 2>&1 || net start MySQL80 >nul 2>&1
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr :3306 >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Đã khởi động dịch vụ MySQL thành công!
    ) else (
        echo [!] Cảnh báo: Chưa phát hiện MySQL trên cổng 3306.
        echo     Vui lòng đảm bảo MySQL / Laragon / XAMPP đã được bật.
    )
) else (
    echo [OK] MySQL: Đang chạy sẵn sàng trên cổng 3306
)

:: 3. Kiểm tra dependencies của Worker
echo.
echo [1/4] Kiểm tra thư viện Worker Engine (Playwright)...
if not exist "%ROOT_DIR%worker\node_modules" (
    echo [*] Thư viện worker chưa cài đặt. Đang chạy npm install...
    cd /d "%ROOT_DIR%worker"
    call npm install
    cd /d "%ROOT_DIR%"
) else (
    echo [OK] Thư viện Worker đã đầy đủ.
)

:: 4. Kiểm tra dependencies của Frontend
echo.
echo [2/4] Kiểm tra thư viện Frontend React/Vite...
if not exist "%ROOT_DIR%frontend\node_modules" (
    echo [*] Thư viện frontend chưa cài đặt. Đang chạy npm install...
    cd /d "%ROOT_DIR%frontend"
    call npm install
    cd /d "%ROOT_DIR%"
) else (
    echo [OK] Thư viện Frontend đã đầy đủ.
)

:: 5. Khởi chạy Worker Engine (Port 3001)
echo.
echo [3/4] Đang khởi chạy Worker Engine (Port 3001)...
start "Toolzutter Worker Engine (Port 3001)" cmd /k "cd /d "%ROOT_DIR%worker" && title Worker Engine 3001 && node server.js"

:: 6. Khởi chạy Backend Spring Boot (Port 8081)
echo.
echo [4/4] Đang khởi chạy Backend Spring Boot (Port 8081)...
start "Toolzutter Spring Boot Backend (Port 8081)" cmd /k "cd /d "%ROOT_DIR%backend" && title Backend 8081 && mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=dev"

:: 7. Khởi chạy Frontend Vite Dev Server (Port 3000)
echo.
echo [*] Đang khởi chạy Frontend Vite (Port 3000)...
start "Toolzutter Frontend Vite (Port 3000)" cmd /k "cd /d "%ROOT_DIR%frontend" && title Frontend 3000 && npm.cmd run dev"

echo.
echo ==============================================================================
echo   🎉 HỆ THỐNG ĐÃ ĐƯỢC KHỞI ĐỘNG THÀNH CÔNG!
echo ==============================================================================
echo.
echo   🌐 Web UI:       http://localhost:3000
echo   ⚙️  Backend API:  http://localhost:8081
echo   🤖 Playwright:   http://localhost:3001/api/health
echo.
echo   🔑 Tài khoản mặc định:
echo      - Email:      admin@gmail.com
echo      - Mật khẩu:   123456
echo.
echo ==============================================================================
echo Đang mở trình duyệt sau 3 giây...
timeout /t 3 /nobreak >nul
start http://localhost:3000
echo.
echo Nhấn phím bất kỳ để đóng cửa sổ điều khiển này (các dịch vụ vẫn tiếp tục chạy).
pause >nul
exit /b 0
