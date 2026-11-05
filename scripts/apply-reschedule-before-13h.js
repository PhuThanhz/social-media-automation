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

    console.log(`Bắt đầu xếp lại lịch cho ${posts.length} bài PENDING trước 13:00...`);

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
    endDate.setHours(12, 50, 0, 0); // Kết thúc lúc 12:50 (trước 13:00)

    const updates = [];
    let accIndex = 0;

    for (const [accKey, accPosts] of byAccount.entries()) {
      const accStartMs = baseDate.getTime() + (accIndex % 4) * 60 * 1000;
      const accEndMs = endDate.getTime();
      const n = accPosts.length;
      const stepMs = n > 1 ? (accEndMs - accStartMs) / (n - 1) : 0;

      accPosts.forEach((p, idx) => {
        const postTime = new Date(accStartMs + idx * stepMs);
        postTime.setMilliseconds(0);
        updates.push({ id: p.id, newTime: postTime });
      });
      accIndex++;
    }

    await connection.beginTransaction();

    for (const u of updates) {
      const timeStr = formatMySQLDateTime(u.newTime);
      await connection.execute(`
        UPDATE post_queue 
        SET scheduled_at = ? 
        WHERE id = ? AND status = 'PENDING'
      `, [timeStr, u.id]);
    }

    await connection.commit();
    console.log(`✅ Đã cập nhật thành công ${updates.length} bài viết!`);

    updates.sort((a, b) => a.newTime.getTime() - b.newTime.getTime());
    console.log(`🚀 Bài đầu tiên sẽ đăng lúc: ${formatMySQLDateTime(updates[0].newTime)}`);
    console.log(`🏁 Bài cuối cùng sẽ đăng lúc: ${formatMySQLDateTime(updates[updates.length - 1].newTime)} (hoàn tất trước 13:00)`);
  } catch (err) {
    await connection.rollback();
    console.error('❌ Lỗi khi cập nhật:', err.message);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);

