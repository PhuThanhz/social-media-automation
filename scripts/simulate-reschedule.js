const mysql = require('../worker/node_modules/mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  try {
    const [posts] = await connection.execute(`
      SELECT id, title, target_fanpage_id, target_group_names, scheduled_at
      FROM post_queue
      WHERE status = 'PENDING'
      ORDER BY id ASC
    `);

    console.log(`Tổng số bài PENDING cần xếp lại: ${posts.length}`);

    // Gom nhóm theo tài khoản (connection / target_fanpage_id)
    const byAccount = new Map();
    for (const post of posts) {
      const accKey = post.target_fanpage_id || 'UNKNOWN';
      if (!byAccount.has(accKey)) {
        byAccount.set(accKey, []);
      }
      byAccount.get(accKey).push(post);
    }

    console.log(`Số tài khoản khác nhau: ${byAccount.size}`);

    // Mốc thời gian: từ 16:02 hôm nay đến 21:48 hôm nay
    const baseDate = new Date();
    baseDate.setHours(16, 2, 0, 0); // 16:02:00

    const endDate = new Date();
    endDate.setHours(21, 48, 0, 0); // 21:48:00

    const totalWindowMs = endDate.getTime() - baseDate.getTime(); // ~346 phút

    const updates = [];
    let accIndex = 0;

    for (const [accKey, accPosts] of byAccount.entries()) {
      // Giãn cách khởi đầu giữa các nick 90 giây
      const accStartMs = baseDate.getTime() + (accIndex % 5) * 90 * 1000;
      const accEndMs = endDate.getTime();
      const n = accPosts.length;

      console.log(`Nick ${accKey}: ${n} bài viết`);

      if (n === 1) {
        updates.push({ id: accPosts[0].id, newTime: new Date(accStartMs) });
      } else {
        const stepMs = (accEndMs - accStartMs) / (n - 1);
        accPosts.forEach((p, idx) => {
          const postTime = new Date(accStartMs + idx * stepMs);
          // Làm tròn đến giây chẵn
          postTime.setMilliseconds(0);
          updates.push({ id: p.id, newTime: postTime });
        });
      }
      accIndex++;
    }

    // Sắp xếp updates theo thời gian mới để kiểm tra
    updates.sort((a, b) => a.newTime.getTime() - b.newTime.getTime());

    console.log(`\nBài sớm nhất sau khi xếp: ${updates[0].newTime.toLocaleString('vi-VN')}`);
    console.log(`Bài muộn nhất sau khi xếp: ${updates[updates.length - 1].newTime.toLocaleString('vi-VN')}`);

    // Thống kê theo từng giờ
    const hourCounts = {};
    for (const u of updates) {
      const h = u.newTime.getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
    console.log('\nThống kê số bài mỗi giờ:');
    for (const h of Object.keys(hourCounts).sort((a, b) => a - b)) {
      console.log(`- ${h}h00 -> ${h}h59: ${hourCounts[h]} bài`);
    }

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
