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

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas'
  });

  console.log('Connected to MySQL.');

  // 1. Rebalance co-admin: move 3 posts of Làm Gì Mà Gấp (128 -> 93) and 3 posts of Làm Sen (125 -> 110)
  const [rows128] = await connection.query(`
    SELECT id FROM post_queue 
    WHERE status = 'PENDING' AND target_fanpage_id = '61551923480422:PERSONAL_COOKIE:128'
    ORDER BY scheduled_at ASC LIMIT 3
  `);
  if (rows128.length > 0) {
    const ids = rows128.map(r => r.id);
    await connection.query(`UPDATE post_queue SET target_fanpage_id = '61551923480422:PERSONAL_COOKIE:93' WHERE id IN (?)`, [ids]);
    console.log(`Đã chuyển 3 bài Làm Gì Mà Gấp sang conn 93 (Huỳnh Thạnh Phú)`);
  }

  const [rows125] = await connection.query(`
    SELECT id FROM post_queue 
    WHERE status = 'PENDING' AND target_fanpage_id = '61584834510803:PERSONAL_COOKIE:125'
    ORDER BY scheduled_at ASC LIMIT 3
  `);
  if (rows125.length > 0) {
    const ids = rows125.map(r => r.id);
    await connection.query(`UPDATE post_queue SET target_fanpage_id = '61584834510803:PERSONAL_COOKIE:110' WHERE id IN (?)`, [ids]);
    console.log(`Đã chuyển 3 bài Làm Sen sang conn 110 (Huỳnh Thạnh Phú)`);
  }

  // 2. Fetch pending posts for Via Thành An
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

  // Base start time: 12:47:00 today (2026-11-27)
  const baseStart = new Date(2026, 10, 27, 12, 47, 0);
  const GAP_MS = 270 * 1000; // 4.5 minutes gap for each via
  const OFFSET_PHU_MS = 135 * 1000; // 2 minutes 15 seconds offset

  // Update Via Thành An: 12:47:00, 12:51:30, 12:56:00...
  for (let i = 0; i < postsThanhAn.length; i++) {
    const postTime = new Date(baseStart.getTime() + i * GAP_MS);
    await connection.query(
      `UPDATE post_queue SET scheduled_at = ?, window_deferred = NULL WHERE id = ?`,
      [formatDate(postTime), postsThanhAn[i].id]
    );
  }

  // Update Via Huỳnh Thạnh Phú: 12:49:15, 12:53:45, 12:58:15...
  for (let i = 0; i < postsPhu.length; i++) {
    const postTime = new Date(baseStart.getTime() + OFFSET_PHU_MS + i * GAP_MS);
    await connection.query(
      `UPDATE post_queue SET scheduled_at = ?, window_deferred = NULL WHERE id = ?`,
      [formatDate(postTime), postsPhu[i].id]
    );
  }

  console.log('✅ Đã cập nhật lại toàn bộ lịch đăng tốc độ nhanh cho chiều nay!');

  // Summary
  const [summary] = await connection.query(`
    SELECT
      CASE
        WHEN target_fanpage_id LIKE '%:125' OR target_fanpage_id LIKE '%:126' OR target_fanpage_id LIKE '%:127' OR target_fanpage_id LIKE '%:128' OR target_fanpage_id LIKE '%:35' THEN 'Via Thành An'
        WHEN target_fanpage_id LIKE '%:110' OR target_fanpage_id LIKE '%:111' OR target_fanpage_id LIKE '%:90' OR target_fanpage_id LIKE '%:93' OR target_fanpage_id LIKE '%:129' OR target_fanpage_id LIKE '%:152' OR target_fanpage_id LIKE '%:36' THEN 'Via Huỳnh Thạnh Phú'
        ELSE 'Khác'
      END as via_name,
      COUNT(*) as count,
      MIN(TIME(scheduled_at)) as start_time,
      MAX(TIME(scheduled_at)) as finish_time
    FROM post_queue
    WHERE status = 'PENDING'
    GROUP BY via_name
  `);

  console.table(summary);
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
