const mysql = require('/Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/worker/node_modules/mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas'
  });

  console.log('Connected to MySQL autopost_saas database.');

  // Config: for each co-admin page, how many posts to transfer from Via Thành An to Via Huỳnh Thạnh Phú
  const transferPlan = [
    {
      pageName: 'Làm Sen',
      fromTarget: '61584834510803:PERSONAL_COOKIE:125',
      toTarget: '61584834510803:PERSONAL_COOKIE:110',
      targetCount: 20
    },
    {
      pageName: 'Làm Gì Mà Gấp',
      fromTarget: '61551923480422:PERSONAL_COOKIE:128',
      toTarget: '61551923480422:PERSONAL_COOKIE:93',
      targetCount: 16
    },
    {
      pageName: 'Làm phước',
      fromTarget: '61575018530670:PERSONAL_COOKIE:127',
      toTarget: '61575018530670:PERSONAL_COOKIE:90',
      targetCount: 14
    },
    {
      pageName: 'Làm Phước Hai',
      fromTarget: '61589245661782:PERSONAL_COOKIE:126',
      toTarget: '61589245661782:PERSONAL_COOKIE:111',
      targetCount: 14
    }
  ];

  let totalTransferred = 0;

  for (const plan of transferPlan) {
    const [rows] = await connection.query(
      `SELECT id, scheduled_at FROM post_queue WHERE status = 'PENDING' AND target_fanpage_id = ? ORDER BY scheduled_at ASC`,
      [plan.fromTarget]
    );

    console.log(`\n📌 [${plan.pageName}] Tổng bài PENDING hiện tại: ${rows.length}. Mục tiêu chuyển sang Via Huỳnh Thạnh Phú: ${plan.targetCount}`);
    if (rows.length === 0) continue;

    // Pick every Nth post to transfer so it spreads evenly across time
    const step = Math.max(2, Math.floor(rows.length / plan.targetCount));
    const toTransferIds = [];

    for (let i = 0; i < rows.length && toTransferIds.length < plan.targetCount; i++) {
      if (i % step === 0) {
        toTransferIds.push(rows[i].id);
      }
    }

    if (toTransferIds.length > 0) {
      await connection.query(
        `UPDATE post_queue SET target_fanpage_id = ? WHERE id IN (?)`,
        [plan.toTarget, toTransferIds]
      );
      console.log(`  ✅ Đã chuyển ${toTransferIds.length} bài sang ${plan.toTarget} (IDs: ${toTransferIds.slice(0, 5).join(', ')}...)`);
      totalTransferred += toTransferIds.length;
    }
  }

  console.log(`\n🎉 Tổng số bài đã điều phối cân bằng: ${totalTransferred} bài.`);

  // Verify final count per via
  const [summary] = await connection.query(`
    SELECT
      CASE
        WHEN target_fanpage_id LIKE '%:125' OR target_fanpage_id LIKE '%:126' OR target_fanpage_id LIKE '%:127' OR target_fanpage_id LIKE '%:128' OR target_fanpage_id LIKE '%:35' THEN 'Via Thành An (c_user: 100023403136194)'
        WHEN target_fanpage_id LIKE '%:110' OR target_fanpage_id LIKE '%:111' OR target_fanpage_id LIKE '%:90' OR target_fanpage_id LIKE '%:93' OR target_fanpage_id LIKE '%:129' OR target_fanpage_id LIKE '%:152' OR target_fanpage_id LIKE '%:36' THEN 'Via Huỳnh Thạnh Phú (c_user: 100009194846268)'
        ELSE 'Khác'
      END as via_name,
      COUNT(*) as post_count
    FROM post_queue
    WHERE status = 'PENDING'
    GROUP BY via_name
  `);

  console.log('\n📊 KẾT QUẢ PHÂN BỔ HÀNG ĐỢI SAU KHI CÂN BẰNG:');
  console.table(summary);

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
