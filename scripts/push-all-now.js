const mysql = require('../worker/node_modules/mysql2/promise');

async function main() {
  console.log('=== ĐẨY TOÀN BỘ BÀI VIẾT PENDING CHẠY NGAY LẬP TỨC ===');
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: process.env.DB_PASSWORD || '26082003',
      database: 'autopost_saas'
    });

    const [result] = await connection.execute(`
      UPDATE post_queue 
      SET scheduled_at = NOW() 
      WHERE status = 'PENDING' AND (scheduled_at > NOW() OR scheduled_at IS NULL)
    `);
    console.log(`✅ Đã cập nhật ${result.affectedRows} bài viết PENDING về thời gian hiện tại!`);
    console.log('🚀 Scheduler sẽ tự động phân bổ và đăng toàn bộ các bài này ngay lập tức theo cơ chế song song mới.');
    await connection.end();
  } catch (err) {
    console.error('❌ Lỗi cập nhật hàng đợi:', err.message);
  }
}

main();
