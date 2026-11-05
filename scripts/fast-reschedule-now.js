const mysql = require('../worker/node_modules/mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '26082003',
    database: 'autopost_saas'
  });

  console.log('✅ Connected to MySQL database autopost_saas.');

  // 1. Fetch pending posts
  const [posts] = await conn.execute(
    `SELECT id, target_group_names, target_fanpage_id, scheduled_at, status 
     FROM post_queue 
     WHERE status = 'PENDING' 
     ORDER BY id ASC`
  );

  console.log(`📊 Found ${posts.length} PENDING posts.`);
  if (posts.length === 0) {
    console.log('No pending posts to reschedule.');
    await conn.end();
    return;
  }

  // 2. Group posts by target (group name or fanpage id) for fair round-robin interleaving
  const targetMap = new Map();
  for (const post of posts) {
    const key = post.target_group_names || post.target_fanpage_id || 'unknown';
    if (!targetMap.has(key)) {
      targetMap.set(key, []);
    }
    targetMap.get(key).push(post);
  }

  console.log(`🎯 Distinct targets (${targetMap.size}):`, Array.from(targetMap.keys()));

  // 3. Interleave posts in round-robin order
  const interleaved = [];
  const queues = Array.from(targetMap.values());
  let hasMore = true;
  let round = 0;
  while (hasMore) {
    hasMore = false;
    for (const q of queues) {
      if (round < q.length) {
        interleaved.push(q[round]);
        hasMore = true;
      }
    }
    round++;
  }

  // 4. Schedule rapidly starting from now + 2 minutes
  // Gap between any two consecutive posts: 2 minutes
  // This allows workers to pick up post by post without overlapping or hammering Facebook too hard.
  const startTime = new Date(Date.now() + 2 * 60 * 1000); // 2 mins from now
  const intervalSeconds = 120; // 2 minutes between each post

  console.log(`⏰ Starting rapid queue at: ${startTime.toLocaleString('vi-VN')}`);

  let updatedCount = 0;
  for (let i = 0; i < interleaved.length; i++) {
    const post = interleaved[i];
    const postTime = new Date(startTime.getTime() + i * intervalSeconds * 1000);
    
    // Format YYYY-MM-DD HH:mm:ss for MySQL
    const pad = (n) => String(n).padStart(2, '0');
    const formattedTime = `${postTime.getFullYear()}-${pad(postTime.getMonth() + 1)}-${pad(postTime.getDate())} ${pad(postTime.getHours())}:${pad(postTime.getMinutes())}:${pad(postTime.getSeconds())}`;

    await conn.execute(
      'UPDATE post_queue SET scheduled_at = ? WHERE id = ? AND status = "PENDING"',
      [formattedTime, post.id]
    );

    updatedCount++;
    console.log(`[${updatedCount}/${interleaved.length}] Post #${post.id} -> Target: "${post.target_group_names || post.target_fanpage_id}" -> ${formattedTime}`);
  }

  const endTime = new Date(startTime.getTime() + (interleaved.length - 1) * intervalSeconds * 1000);
  console.log(`\n🎉 HOÀN TẤT! Đã cập nhật ${updatedCount} bài viết.`);
  console.log(`🚀 Bắt đầu đăng từ: ${startTime.toLocaleTimeString('vi-VN')}`);
  console.log(`🏁 Dự kiến xong hết lúc: ${endTime.toLocaleTimeString('vi-VN')}`);

  await conn.end();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
