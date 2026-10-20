#!/bin/bash
# Xoay vòng log cho backend + worker (autopost-saas) — chạy tự động mỗi ngày qua launchd
# (com.autopost.logrotate.plist), có thể chạy tay bất cứ lúc nào để dọn ngay.
#
# Vì cả 2 service ghi log bằng cách launchd redirect thẳng stdout/stderr ra file (không tự xoay
# vòng), file cứ phình vô hạn. Script này: nếu file vượt ngưỡng -> nén archive theo timestamp,
# tạo file rỗng mới, rồi restart service để nó mở lại file log mới (launchd StandardOutPath mở
# lại ngay khi process khởi động).

set -euo pipefail

LOG_DIR="$HOME/Library/Logs"
MAX_SIZE_MB=20
KEEP_ARCHIVES=7
UID_NUM=$(id -u)

rotate_one() {
  local file="$1"
  local service_label="$2"

  [ -f "$file" ] || return 0

  local size_mb
  size_mb=$(( $(stat -f%z "$file" 2>/dev/null || echo 0) / 1024 / 1024 ))

  if [ "$size_mb" -lt "$MAX_SIZE_MB" ]; then
    echo "[log-rotate] $file: ${size_mb}MB, chưa cần xoay (ngưỡng ${MAX_SIZE_MB}MB)."
    return 0
  fi

  local ts
  ts=$(date +%Y%m%d-%H%M%S)
  local archive="${file}.${ts}.gz"

  echo "[log-rotate] $file: ${size_mb}MB >= ${MAX_SIZE_MB}MB -> nén thành $archive và restart $service_label"
  gzip -c "$file" > "$archive"
  : > "$file"

  launchctl kickstart -k "gui/${UID_NUM}/${service_label}" 2>/dev/null || true

  # Dọn archive cũ, chỉ giữ lại KEEP_ARCHIVES bản gần nhất
  ls -1t "${file}".*.gz 2>/dev/null | tail -n +$((KEEP_ARCHIVES + 1)) | xargs -r rm -f
}

rotate_one "$LOG_DIR/autopost-backend.log" "com.autopost.backend"
rotate_one "$LOG_DIR/autopost-worker.log" "com.autopost.worker"
