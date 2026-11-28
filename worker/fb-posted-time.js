// Đổi chữ thời gian Facebook hiển thị trên bài viết ("3 giờ", "Hôm qua lúc 14:20",
// "15 tháng 10", "Oct 15 at 3:00 PM"...) thành mốc thời gian (ms) theo giờ máy chạy worker.
// Trả về null khi không đọc được (Facebook hay xáo chữ timestamp trong Group).

const EN_MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const VI_WEEKDAYS = {
  'chủ nhật': 0, 'thứ hai': 1, 'thứ ba': 2, 'thứ tư': 3, 'thứ năm': 4, 'thứ sáu': 5, 'thứ bảy': 6,
  'thứ 2': 1, 'thứ 3': 2, 'thứ 4': 3, 'thứ 5': 4, 'thứ 6': 5, 'thứ 7': 6, 'cn': 0,
};
const EN_WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Đọc "lúc 14:30", "at 3:05 PM", "14:30" → [giờ, phút]
function readClock(t) {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm|sa|ch)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3];
  if ((ap === 'pm' || ap === 'ch') && h < 12) h += 12;
  if ((ap === 'am' || ap === 'sa') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

function atDay(base, clock) {
  const d = new Date(base);
  if (clock) d.setHours(clock[0], clock[1], 0, 0);
  else d.setHours(12, 0, 0, 0);
  return d.getTime();
}

// Ngày dương lịch không có năm: lấy năm nay, nếu rơi vào tương lai thì là năm trước
function calendarDate(day, month, year, clock, now) {
  if (day < 1 || day > 31 || month < 0 || month > 11) return null;
  const nowDate = new Date(now);
  const y = year || nowDate.getFullYear();
  const d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  let ts = atDay(d, clock);
  if (!year && ts > now + DAY) {
    const prev = new Date(y - 1, month, day);
    ts = atDay(prev, clock);
  }
  return ts;
}

function parseFbPostedTime(raw, now = Date.now()) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  let t = String(raw).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').replace(/·/g, ' ').trim();
  if (!t || t === 'gần đây') return null;

  // Xoá các text rác thường đi kèm trên Facebook như "Online status in", "chia sẻ công khai", "public"
  t = t.replace(/^.*?(?:online status in|trực tuyến|tác giả|bởi)\s*/i, '');
  t = t.replace(/\s*(?:công khai|thành viên|bạn bè|chỉ mình tôi|public|friends|shared with).*$/i, '');
  t = t.replace(/^[·•\s\-_]+|[·•\s\-_]+$/g, '').trim();

  if (/^(?:vừa xong|just now|bây giờ|now)\b/.test(t)) return now;

  // Ngày cụ thể "26 tháng 11, 2026" phải xét TRƯỚC thời gian tương đối — nếu không "26 tháng" bị hiểu là "26 tháng trước"
  const calVi = t.match(/(\d{1,2})\s*(?:tháng|thg)\s*(\d{1,2})(?!\s*(?:phút|giờ|ngày|tuần|năm trước))(?:\s*(?:,|năm)\s*(\d{4}))?/);
  if (calVi && parseInt(calVi[2], 10) >= 1 && parseInt(calVi[2], 10) <= 12) {
    return calendarDate(parseInt(calVi[1], 10), parseInt(calVi[2], 10) - 1, calVi[3] ? parseInt(calVi[3], 10) : null, readClock(t), now);
  }

  // Thời gian tương đối: "5 phút", "3 giờ trước", "2 ngày", "1 tuần", "5m", "3h", "2d", "1w", "1y"
  const rel = t.match(/(?:^|\s)(\d{1,3})\s*(phút|giờ|ngày|tuần|tháng|năm|mins?|minutes?|hrs?|hours?|days?|weeks?|years?|yrs?|m|h|d|w|y)(?:\s+trước|\s+ago)?(?:\s|$)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    if (/^(phút|m|mins?|minutes?)$/.test(unit)) return now - n * MINUTE;
    if (/^(giờ|h|hrs?|hours?)$/.test(unit)) return now - n * HOUR;
    if (/^(ngày|d|days?)$/.test(unit)) return now - n * DAY;
    if (/^(tuần|w|weeks?)$/.test(unit)) return now - n * 7 * DAY;
    if (/^(tháng)$/.test(unit)) return now - n * 30 * DAY;
    if (/^(năm|y|yrs?|years?)$/.test(unit)) return now - n * 365 * DAY;
  }

  const clock = readClock(t);

  if (/^(hôm nay|today)\b/.test(t)) return atDay(now, clock);
  if (/^(hôm qua|yesterday)\b/.test(t)) return atDay(now - DAY, clock);

  // "15 tháng 10", "15 tháng 10, 2025", "15 tháng 10 năm 2025 lúc 14:30"
  let m = t.match(/(\d{1,2})\s*(?:tháng|thg)\s*(\d{1,2})(?:\s*(?:,|năm)\s*(\d{4}))?/);
  if (m) return calendarDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : null, clock, now);

  // "15/10", "15/10/2025"
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (m) return calendarDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : null, clock, now);

  // "October 15", "Oct 15, 2025 at 3:00 PM"
  m = t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (m && EN_MONTHS[m[1]] !== undefined) {
    return calendarDate(parseInt(m[2], 10), EN_MONTHS[m[1]], m[3] ? parseInt(m[3], 10) : null, clock, now);
  }
  // "15 October 2025"
  m = t.match(/\b(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?/);
  if (m && EN_MONTHS[m[2]] !== undefined) {
    return calendarDate(parseInt(m[1], 10), EN_MONTHS[m[2]], m[3] ? parseInt(m[3], 10) : null, clock, now);
  }

  // "Thứ Hai lúc 10:00", "Monday at 10:00 AM" → ngày gần nhất trong tuần qua
  let weekday = null;
  for (const [name, idx] of Object.entries(VI_WEEKDAYS)) {
    if (t.startsWith(name)) { weekday = idx; break; }
  }
  if (weekday === null) {
    for (const [name, idx] of Object.entries(EN_WEEKDAYS)) {
      if (t.startsWith(name) || t.startsWith(name.slice(0, 3) + ' ')) { weekday = idx; break; }
    }
  }
  if (weekday !== null) {
    const today = new Date(now).getDay();
    let back = (today - weekday + 7) % 7;
    if (back === 0) back = 7;
    return atDay(now - back * DAY, clock);
  }

  return null;
}

// "YYYY-MM-DD" → mốc đầu ngày / cuối ngày theo giờ máy
function dayBoundary(ymd, endOfDay) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

module.exports = { parseFbPostedTime, dayBoundary };
