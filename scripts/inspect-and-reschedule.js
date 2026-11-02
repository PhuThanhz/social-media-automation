const mysql = require('../worker/node_modules/mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  try {
    const [rows] = await connection.execute(`
      SELECT id, title, status, scheduled_at, target_fanpage_id, target_group_names 
      FROM post_queue 
      WHERE status = 'PENDING'
      ORDER BY scheduled_at ASC, id ASC
    `);

    console.log(`Tìm thấy ${rows.length} bài viết PENDING trong hàng đợi.`);
    if (rows.length > 0) {
      console.log(`Bài sớm nhất: ${rows[0].scheduled_at}`);
      console.log(`Bài muộn nhất: ${rows[rows.length - 1].scheduled_at}`);
    }
    return rows;
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
