#!/bin/bash
# Auto-restart worker server — tự động khởi động lại khi crash (trừ khi port đã bị dùng)
cd "$(dirname "$0")"

while true; do
  echo "[AutoRestart] 🚀 Khởi động Worker Server..."
  node --max-old-space-size=1024 server.js
  EXIT_CODE=$?

  # Nếu exit do EADDRINUSE (port bị chiếm), không restart
  if [ $EXIT_CODE -eq 1 ]; then
    echo "[AutoRestart] ❌ Port đã bị chiếm hoặc lỗi khởi động — dừng lại."
    exit 1
  fi

  echo "[AutoRestart] ⚠️ Server thoát với code $EXIT_CODE — tự động khởi động lại sau 3 giây..."
  sleep 3
done
