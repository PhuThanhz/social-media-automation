const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SETTINGS_FILE = path.join(__dirname, 'system_settings.json');

const DEFAULT_SETTINGS = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notifyOnViaDead: true,
  notifyOnHunter: true,
  notifyOnBuffDone: true,
  maxDailyPageActions: 25,
  // Tự buff bài do chính app vừa đăng (Fanpage / Group) xoay vòng page của mọi via
  autoBuffOwnPosts: false,
  autoBuffOwnFanpage: true,
  autoBuffOwnGroup: true,
  autoBuffDelayMinutes: 3,
  autoBuffReaction: 'RANDOM_POSITIVE',
  // Quy mô lớn (1000+ page): số page tối đa cho 1 bài khi chọn "xoay vòng", số via chạy song song
  maxPagesPerPost: 150,
  buffParallelVias: 4,
  isEmergencyStopped: false,
  emergencyReason: '',
  emergencyStoppedAt: null,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (err) {
    console.warn(`[Settings] ⚠️ Lỗi đọc system_settings.json: ${err.message}`);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    const current = loadSettings();
    const updated = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error(`[Settings] ❌ Lỗi ghi system_settings.json: ${err.message}`);
    return null;
  }
}

async function sendTelegramMessage(text, parseMode = 'HTML') {
  const settings = loadSettings();
  const token = settings.telegramBotToken;
  const chatId = settings.telegramChatId;

  if (!token || !chatId) {
    return { success: false, reason: 'Chưa cấu hình Telegram Bot Token hoặc Chat ID' };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await axios.post(
      url,
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      },
      { timeout: 8000 }
    );
    return { success: true, data: res.data };
  } catch (err) {
    const errMsg = err.response?.data?.description || err.message;
    console.warn(`[Telegram] ⚠️ Không gửi được tin nhắn: ${errMsg}`);
    return { success: false, reason: errMsg };
  }
}

// 1. CẢNH BÁO VIA CHECKPOINT / EXPIRED
async function notifyViaDead(viaInfo = {}, error = '') {
  const settings = loadSettings();
  if (!settings.notifyOnViaDead) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🚨 <b>[CẢNH BÁO BẢO VỆ VIA FB]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Tên Via:</b> ${viaInfo.viaName || viaInfo.name || 'Không rõ'}`,
    `🆔 <b>UID:</b> <code>${viaInfo.uid || 'N/A'}</code>`,
    `🌐 <b>Proxy:</b> <code>${viaInfo.proxyUrl ? viaInfo.proxyUrl.replace(/:[^:]+@/, ':***@') : 'Direct IP'}</code>`,
    `⚠️ <b>Trạng thái:</b> <b>${viaInfo.tokenStatus || 'CHECKPOINT / DIE'}</b>`,
    `📝 <b>Chi tiết:</b> ${error || 'Cookie hết hạn hoặc FB yêu cầu xác minh'}`,
    `⏰ <b>Thời gian:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🛡️ <i>Hệ thống đã tự động cô lập Via này để không làm hỏng BM và chuyển sang Via phụ khác!</i>`,
  ].join('\n');

  return sendTelegramMessage(msg);
}

// 2. THÔNG BÁO HUNTER PHÁT HIỆN BÀI MỚI
async function notifyPostHunted({ targetName, targetUrl, postUrl, delayMinutes, targetLikes }) {
  const settings = loadSettings();
  if (!settings.notifyOnHunter) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🎯 <b>[HUNTER: PHÁT HIỆN BÀI VIẾT MỚI]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📌 <b>Mục tiêu:</b> ${targetName || 'Fanpage/Group'}`,
    `🔗 <b>Link bài:</b> <a href="${postUrl}">${postUrl}</a>`,
    `⚡ <b>Mục tiêu buff:</b> ${targetLikes === 'ALL' ? 'xoay vòng page (theo giới hạn mỗi bài)' : `${targetLikes || 30} lượt thích & tương tác`}`,
    `⏳ <b>Chờ tự nhiên:</b> ${delayMinutes || 3} phút trước khi kích hoạt`,
    `⏰ <b>Thời gian phát hiện:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🤖 <i>Đã tự động xếp vào Hàng đợi Buff Tự Động!</i>`,
  ].join('\n');

  return sendTelegramMessage(msg);
}

// 3. THÔNG BÁO CHIẾN DỊCH HOÀN TẤT
async function notifyBuffCompleted({ targetUrl, success, total, failed, durationSec, reactionType }) {
  const settings = loadSettings();
  if (!settings.notifyOnBuffDone) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  const statusEmoji = successRate >= 80 ? '🎉' : '⚠️';

  const msg = [
    `${statusEmoji} <b>[BUFF HOÀN TẤT CHIẾN DỊCH]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `❤️ <b>Loại Reaction:</b> ${reactionType || 'RANDOM'}`,
    `✅ <b>Thành công:</b> <b>${success}</b> / ${total} Page (${successRate}%)`,
    `❌ <b>Thất bại:</b> ${failed || 0}`,
    `⏱️ <b>Thời gian xử lý:</b> ${durationSec || 0}s`,
    `⏰ <b>Hoàn tất lúc:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🚀 <i>Tương tác tự nhiên hoàn thành an toàn 100%!</i>`,
  ].join('\n');

  return sendTelegramMessage(msg);
}

// 4. CẢNH BÁO DỪNG KHẨN CẤP
async function notifyEmergencyStop({ triggeredBy = 'Admin', reason = '' }) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🛑 <b>[KHẨN CẤP: TOÀN BỘ HỆ THỐNG ĐÃ DỪNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Người kích hoạt:</b> ${triggeredBy}`,
    `⚠️ <b>Lý do:</b> ${reason || 'Yêu cầu dừng khẩn cấp từ người quản trị'}`,
    `⏰ <b>Thời gian:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `⛔ <i>Tất cả trình duyệt Playwright và Queue đã được tạm dừng ngay lập tức.</i>`,
  ].join('\n');

  return sendTelegramMessage(msg);
}

function isEmergencyStopped() {
  const settings = loadSettings();
  return Boolean(settings.isEmergencyStopped);
}

function setEmergencyStop(stopped, reason = '') {
  const updated = saveSettings({
    isEmergencyStopped: Boolean(stopped),
    emergencyReason: stopped ? reason : '',
    emergencyStoppedAt: stopped ? new Date().toISOString() : null,
  });
  if (stopped) {
    notifyEmergencyStop({ reason });
  }
  return updated;
}

module.exports = {
  loadSettings,
  saveSettings,
  sendTelegramMessage,
  notifyViaDead,
  notifyPostHunted,
  notifyBuffCompleted,
  notifyEmergencyStop,
  isEmergencyStopped,
  setEmergencyStop,
};
