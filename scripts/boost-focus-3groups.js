const mysql = require('../worker/node_modules/mysql2/promise');

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatMySQLDateTime(d) {
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

async function main() {
  console.log('================================================================');
  console.log('🚀 TẬP TRUNG BUFF BÀI 3 NHÓM (#144, #145, #146) — CHẠY 2 WORKER');
  console.log('================================================================');

  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  const TARGET_3_GROUPS = [
    'GROUP_ONLY:442952455895343', // #144 Vietnam Economy News
    'GROUP_ONLY:414495725353336', // #145 Hóng Hớt Kinh Tế
    'GROUP_ONLY:391775555405184'  // #146 Vietnam Business News
  ];

  try {
    await connection.beginTransaction();

    // 1. DỜI TOÀN BỘ CÁC NHÓM KHÁC RA SAU (để nhường 100% tài nguyên cho 3 nhóm này)
    // Các nhóm khác sẽ dời bắt đầu từ 15:30 chiều nay (sau khi 3 nhóm hoàn tất)
    console.log('\n[1/3] Tạm dời bài của các nhóm khác ra sau (bắt đầu từ 15:30) để tập trung...');
    const [otherGroupsResult] = await connection.execute(`
      UPDATE post_queue
      SET scheduled_at = DATE_ADD(NOW(), INTERVAL 3 HOUR)
      WHERE status = 'PENDING'
        AND (target_group_names NOT IN (?, ?, ?) OR target_group_names IS NULL)
    `, TARGET_3_GROUPS);
    console.log(`   ✅ Đã dời ${otherGroupsResult.affectedRows} bài của các nhóm khác lùi lại 3 tiếng.`);

    // 2. LẤY TOÀN BỘ BÀI PENDING CỦA 3 NHÓM
    console.log('\n[2/3] Gom toàn bộ bài PENDING của 3 nhóm mục tiêu...');
    const [posts] = await connection.execute(`
      SELECT id, title, target_group_names, target_fanpage_id
      FROM post_queue
      WHERE status = 'PENDING'
        AND target_group_names IN (?, ?, ?)
      ORDER BY id ASC
    `, TARGET_3_GROUPS);

    console.log(`   📊 Tìm thấy tổng cộng ${posts.length} bài PENDING của 3 nhóm.`);

    const queues = {
      'GROUP_ONLY:442952455895343': [],
      'GROUP_ONLY:414495725353336': [],
      'GROUP_ONLY:391775555405184': []
    };

    posts.forEach(p => {
      if (queues[p.target_group_names]) {
        queues[p.target_group_names].push(p);
      }
    });

    console.log(`   - #144 (Vietnam Economy News): ${queues['GROUP_ONLY:442952455895343'].length} bài`);
    console.log(`   - #145 (Hóng Hớt Kinh Tế):     ${queues['GROUP_ONLY:414495725353336'].length} bài`);
    console.log(`   - #146 (Vietnam Business News):${queues['GROUP_ONLY:391775555405184'].length} bài`);

    // 3. ĐAN XEN ROUND-ROBIN GIỮA 3 NHÓM VÀ LÊN LỊCH TỐC ĐỘ CAO CHO 2 WORKER
    console.log('\n[3/3] Đan xen Round-Robin & Xếp lịch tốc độ cao (2 Worker chạy song song)...');
    const interleaved = [];
    let round = 0;
    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      for (const t of TARGET_3_GROUPS) {
        if (round < queues[t].length) {
          interleaved.push(queues[t][round]);
          hasMore = true;
        }
      }
      round++;
    }

    const now = new Date();
    // 2 bài đầu tiên cho chạy NGAY LẬP TỨC để 2 worker cùng khởi động song song
    // Các bài tiếp theo giãn cách mỗi bài 60 giây (tương đương mỗi nhóm nghỉ ~3 phút giữa 2 bài)
    const INTERVAL_SECONDS = 60;
    const updates = [];

    for (let i = 0; i < interleaved.length; i++) {
      const p = interleaved[i];
      let postTime;
      if (i < 2) {
        // Bài 0 và Bài 1: bắt đầu ngay tức thì (cách nhau 5 giây) để 2 Worker nhận song song
        postTime = new Date(now.getTime() + (i * 5) * 1000);
      } else {
        // Từ bài thứ 2 trở đi: cách nhau đều 60 giây
        postTime = new Date(now.getTime() + (i - 1) * INTERVAL_SECONDS * 1000);
      }

      updates.push({
        id: p.id,
        target: p.target_group_names,
        fanpage: p.target_fanpage_id,
        time: postTime
      });

      const formatted = formatMySQLDateTime(postTime);
      await connection.execute(`
        UPDATE post_queue
        SET scheduled_at = ?
        WHERE id = ? AND status = 'PENDING'
      `, [formatted, p.id]);
    }

    await connection.commit();

    console.log(`\n🎉 HOÀN TẤT ĐIỀU PHỐI! Đã lên lịch mới cho ${updates.length} bài viết.`);
    console.log(`🚀 Bắt đầu đăng ngay: ${formatMySQLDateTime(updates[0].time)}`);
    console.log(`🏁 Dự kiến xong toàn bộ 77 bài lúc: ${formatMySQLDateTime(updates[updates.length - 1].time)} (~${Math.round((updates[updates.length - 1].time - now) / 60000)} phút nữa)`);
    console.log(`⚡ Khoảng cách an toàn mỗi nhóm: ~3 phút/bài (hoàn toàn tránh checkpoint Facebook).`);
    console.log(`🤖 2 Worker sẽ chạy luân phiên liên tục.`);

  } catch (err) {
    await connection.rollback();
    console.error('❌ Lỗi:', err);
  } finally {
    await connection.end();
  }
}

main();
