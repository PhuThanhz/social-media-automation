const mysql = require('../worker/node_modules/mysql2/promise');

function formatMySQLDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

async function main() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  try {
    const [posts] = await connection.execute(`
      SELECT id, title, target_fanpage_id, scheduled_at
      FROM post_queue
      WHERE status = 'PENDING'
      ORDER BY id ASC
    `);

    console.log(`Tìm thấy ${posts.length} bài PENDING cần xếp lại trước 13:00.`);

    const byAccount = new Map();
    for (const post of posts) {
      const accKey = post.target_fanpage_id || 'UNKNOWN';
      if (!byAccount.has(accKey)) {
        byAccount.set(accKey, []);
      }
      byAccount.get(accKey).push(post);
    }

    const baseDate = new Date();
    baseDate.setMinutes(baseDate.getMinutes() + 2); // Bắt đầu sau 2 phút
    baseDate.setSeconds(0, 0);

    const endDate = new Date();
    endDate.setHours(12, 50, 0, 0); // Kết thúc lúc 12:50 (trước 13h 10 phút để trừ hao)

    const updates = [];
    let accIndex = 0;

    for (const [accKey, accPosts] of byAccount.entries()) {
      const accStartMs = baseDate.getTime() + (accIndex % 4) * 60 * 1000; // So le 1 phút giữa các nick
      const accEndMs = endDate.getTime();
      const n = accPosts.length;
      const stepMs = n > 1 ? (accEndMs - accStartMs) / (n - 1) : 0;
      const intervalMinutes = (stepMs / 60000).toFixed(1);

      console.log(`- Tài khoản [${accKey}]: ${n} bài -> Giãn cách ~${intervalMinutes} phút/bài`);

      accPosts.forEach((p, idx) => {
        const postTime = new Date(accStartMs + idx * stepMs);
        postTime.setMilliseconds(0);
        updates.push({ id: p.id, newTime: postTime, accKey });
      });
      accIndex++;
    }

    updates.sort((a, b) => a.newTime.getTime() - b.newTime.getTime());
    console.log(`\n📊 TỔNG HỢP MÔ PHỎNG:`);
    console.log(`- Tổng số bài: ${updates.length}`);
    console.log(`- Bài đầu tiên dự kiến: ${formatMySQLDateTime(updates[0].newTime)}`);
    console.log(`- Bài cuối cùng dự kiến: ${formatMySQLDateTime(updates[updates.length - 1].newTime)} (trước 13:00)`);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);

