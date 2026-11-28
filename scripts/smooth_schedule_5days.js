const mysql = require('/Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/worker/node_modules/mysql2/promise');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Generate schedule timestamps for a single via:
 * - Tối nay (2026-11-26): từ 16:38/16:44 đến 21:55, giãn cách 13 phút (~24-25 bài/via tối nay, tổng ~48-50 bài tối nay)
 * - Các ngày tới (27..30/11): từ 08:00 đến 21:45, giãn cách 25 phút (~33 bài/ngày/via)
 */
function generateTimestamps(startOffsetMinutes, totalCount) {
  const timestamps = [];
  
  // 1. Tối nay: 2026-11-26
  let cur = new Date(2026, 10, 26, 16, 38 + startOffsetMinutes, 0);
  const endToday = new Date(2026, 10, 26, 21, 55, 0);

  while (cur <= endToday && timestamps.length < totalCount) {
    timestamps.push(formatDate(cur));
    cur = new Date(cur.getTime() + 13 * 60 * 1000); // 13 phút giãn cách tối nay
  }

  // 2. Các ngày sau: 2026-11-27 trở đi
  let dayOffset = 1;
  while (timestamps.length < totalCount) {
    const targetDate = new Date(2026, 10, 26 + dayOffset);
    let dayCur = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 8, startOffsetMinutes, 0);
    const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 21, 45, 0);

    while (dayCur <= dayEnd && timestamps.length < totalCount) {
      timestamps.push(formatDate(dayCur));
      dayCur = new Date(dayCur.getTime() + 25 * 60 * 1000); // 25 phút các ngày sau
    }
    dayOffset++;
  }

  return timestamps;
}

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas'
  });

  console.log('Connected to MySQL.');

  // Fetch pending posts for Via Thành An
  const [postsThanhAn] = await connection.query(`
    SELECT id, scheduled_at, target_fanpage_id
    FROM post_queue
    WHERE status = 'PENDING'
      AND (target_fanpage_id LIKE '%:125' OR target_fanpage_id LIKE '%:126' OR target_fanpage_id LIKE '%:127' OR target_fanpage_id LIKE '%:128' OR target_fanpage_id LIKE '%:35')
    ORDER BY scheduled_at ASC, id ASC
  `);

  // Fetch pending posts for Via Huỳnh Thạnh Phú
  const [postsPhu] = await connection.query(`
    SELECT id, scheduled_at, target_fanpage_id
    FROM post_queue
    WHERE status = 'PENDING'
      AND (target_fanpage_id LIKE '%:110' OR target_fanpage_id LIKE '%:111' OR target_fanpage_id LIKE '%:90' OR target_fanpage_id LIKE '%:93' OR target_fanpage_id LIKE '%:129' OR target_fanpage_id LIKE '%:152' OR target_fanpage_id LIKE '%:36')
    ORDER BY scheduled_at ASC, id ASC
  `);

  console.log(`Via Thành An: ${postsThanhAn.length} bài.`);
  console.log(`Via Huỳnh Thạnh Phú: ${postsPhu.length} bài.`);

  // Via Thành An offset = 0 (bắt đầu 16:38, sau đó 16:51, 17:04...)
  const timesThanhAn = generateTimestamps(0, postsThanhAn.length);
  // Via Huỳnh Thạnh Phú offset = 6 (bắt đầu 16:44, sau đó 16:57, 17:10...)
  const timesPhu = generateTimestamps(6, postsPhu.length);

  // Update Via Thành An
  for (let i = 0; i < postsThanhAn.length; i++) {
    await connection.query(
      `UPDATE post_queue SET scheduled_at = ?, window_deferred = NULL WHERE id = ?`,
      [timesThanhAn[i], postsThanhAn[i].id]
    );
  }
  console.log(`✅ Đã cập nhật lịch đăng cho ${postsThanhAn.length} bài của Via Thành An.`);

  // Update Via Huỳnh Thạnh Phú
  for (let i = 0; i < postsPhu.length; i++) {
    await connection.query(
      `UPDATE post_queue SET scheduled_at = ?, window_deferred = NULL WHERE id = ?`,
      [timesPhu[i], postsPhu[i].id]
    );
  }
  console.log(`✅ Đã cập nhật lịch đăng cho ${postsPhu.length} bài của Via Huỳnh Thạnh Phú.`);

  // Summary by date and via
  const [distribution] = await connection.query(`
    SELECT
      DATE(scheduled_at) as post_date,
      CASE
        WHEN target_fanpage_id LIKE '%:125' OR target_fanpage_id LIKE '%:126' OR target_fanpage_id LIKE '%:127' OR target_fanpage_id LIKE '%:128' OR target_fanpage_id LIKE '%:35' THEN 'Via Thành An'
        WHEN target_fanpage_id LIKE '%:110' OR target_fanpage_id LIKE '%:111' OR target_fanpage_id LIKE '%:90' OR target_fanpage_id LIKE '%:93' OR target_fanpage_id LIKE '%:129' OR target_fanpage_id LIKE '%:152' OR target_fanpage_id LIKE '%:36' THEN 'Via Huỳnh Thạnh Phú'
        ELSE 'Khác'
      END as via_name,
      COUNT(*) as count,
      MIN(TIME(scheduled_at)) as earliest,
      MAX(TIME(scheduled_at)) as latest
    FROM post_queue
    WHERE status = 'PENDING'
    GROUP BY post_date, via_name
    ORDER BY post_date, via_name
  `);

  console.log('\n📊 BẢNG PHÂN BỔ LỊCH ĐĂNG (TĂNG CƯỜNG TỐI NAY + DÀN ĐỀU 4 NGÀY):');
  console.table(distribution);

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
