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
      SELECT id, title, target_fanpage_id, target_group_names, scheduled_at
      FROM post_queue
      WHERE status = 'PENDING'
      ORDER BY id ASC
    `);

    console.log(`Đang xử lý xếp lại lịch cho ${posts.length} bài PENDING...`);

    const byAccount = new Map();
    for (const post of posts) {
      const accKey = post.target_fanpage_id || 'UNKNOWN';
      if (!byAccount.has(accKey)) {
        byAccount.set(accKey, []);
      }
      byAccount.get(accKey).push(post);
    }

    const baseDate = new Date();
    // Bắt đầu ngay sau 2 phút nữa
    baseDate.setMinutes(baseDate.getMinutes() + 2);
    baseDate.setSeconds(0, 0);

    const endDate = new Date();
    endDate.setHours(21, 48, 0, 0); // Muộn nhất 21:48

    const updates = [];
    let accIndex = 0;

    for (const [accKey, accPosts] of byAccount.entries()) {
      const accStartMs = baseDate.getTime() + (accIndex % 5) * 90 * 1000;
      const accEndMs = endDate.getTime();
      const n = accPosts.length;

      if (n === 1) {
        updates.push({ id: accPosts[0].id, newTime: new Date(accStartMs) });
      } else {
        const stepMs = (accEndMs - accStartMs) / (n - 1);
        accPosts.forEach((p, idx) => {
          const postTime = new Date(accStartMs + idx * stepMs);
          postTime.setMilliseconds(0);
          updates.push({ id: p.id, newTime: postTime });
        });
      }
      accIndex++;
    }

    // Thực thi cập nhật theo batch
    console.log(`Bắt đầu cập nhật ${updates.length} bài viết vào Database...`);
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
    console.log(`🚀 Bài đầu tiên sẽ đăng lúc: ${updates[0].newTime.toLocaleString('vi-VN')}`);
    console.log(`🏁 Bài cuối cùng sẽ đăng lúc: ${updates[updates.length - 1].newTime.toLocaleString('vi-VN')} (trước 22h00)`);
  } catch (err) {
    await connection.rollback();
    console.error('❌ Lỗi khi cập nhật:', err.message);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
