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
      SELECT target_fanpage_id, target_group_names, COUNT(*) as cnt 
      FROM post_queue 
      WHERE status = 'PENDING'
      GROUP BY target_fanpage_id, target_group_names
      ORDER BY cnt DESC
    `);
    console.log('Phân bổ theo Target:');
    console.table(rows);

    const [hourly] = await connection.execute(`
      SELECT DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:00') as hr, COUNT(*) as cnt
      FROM post_queue
      WHERE status = 'PENDING'
      GROUP BY hr
      ORDER BY hr ASC
    `);
    console.log('Phân bổ theo Giờ hiện tại:');
    console.table(hourly);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
