#!/bin/bash
cd "$(dirname "$0")"
export PORT=3003
export PROFILE_DIR=browser_profiles_w3
export MAX_PARALLEL_POSTING=1

while true; do
  echo "[AutoRestart] 🚀 Khởi động Worker 3 (Port 3003)..."
  node --max-old-space-size=1024 server.js
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 1 ]; then
    echo "[AutoRestart] ❌ Port 3003 đã bị chiếm hoặc lỗi khởi động — dừng lại."
    exit 1
  fi

  echo "[AutoRestart] ⚠️ Server 3 thoát với code $EXIT_CODE — tự động khởi động lại sau 3 giây..."
  sleep 3
done
