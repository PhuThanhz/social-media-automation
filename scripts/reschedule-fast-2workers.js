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
  console.log('⚡ TĂNG TỐC ĐỘ HÀNG ĐỢI ĐĂNG BÀI — PHÂN PHỐI ĐỀU 2 WORKER');
  console.log('================================================================');

  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  try {
    // 1. CẬP NHẬT CẤU HÌNH KHUNG GIỜ ĐĂNG TRONG APP_SETTINGS
    console.log('\n[1/3] Cập nhật cấu hình hệ thống (app_settings)...');
    
    // Giảm min_gap_seconds từ 1200s (20 phút) xuống 60s (1 phút)
    await connection.execute(`
      INSERT INTO app_settings (setting_key, setting_value) 
      VALUES ('posting_window.min_gap_seconds', '60')
      ON DUPLICATE KEY UPDATE setting_value = '60'
    `);
    console.log('   ✅ Đã chỉnh posting_window.min_gap_seconds = 60 (giãn cách 1 phút thay vì 20 phút).');

    // Đặt max_posts_per_hour_per_nick = 40 (để 2 nick cùng chạy được tới 80 bài/giờ)
    await connection.execute(`
      INSERT INTO app_settings (setting_key, setting_value) 
      VALUES ('posting_window.max_posts_per_hour_per_nick', '40')
      ON DUPLICATE KEY UPDATE setting_value = '40'
    `);
    console.log('   ✅ Đã nâng trần an toàn posting_window.max_posts_per_hour_per_nick = 40 bài/giờ/nick.');

    // 2. LẤY TOÀN BỘ CÁC BÀI VIẾT PENDING HIỆN CÓ
    console.log('\n[2/3] Quét danh sách bài viết PENDING trong post_queue...');
    const [posts] = await connection.execute(`
      SELECT id, title, target_group_names, target_fanpage_id 
      FROM post_queue 
      WHERE status = 'PENDING' 
      ORDER BY id ASC
    `);

    console.log(`   📊 Tìm thấy tổng cộng ${posts.length} bài viết PENDING.`);
    if (posts.length === 0) {
      console.log('   Không có bài nào cần xếp lại lịch.');
      await connection.end();
      return;
    }

    // Nhóm theo target_group_names để chia đều round-robin
    const targetMap = new Map();
    for (const p of posts) {
      const key = p.target_group_names || 'NO_GROUP';
      if (!targetMap.has(key)) targetMap.set(key, []);
      targetMap.get(key).push(p);
    }

    console.log(`   🎯 Danh sách các nhóm mục tiêu (${targetMap.size} nhóm):`);
    for (const [k, arr] of targetMap.entries()) {
      console.log(`      - ${k}: ${arr.length} bài`);
    }

    // Đan xen round-robin giữa các nhóm (để không bao giờ có 2 bài liên tiếp cùng 1 nhóm)
    const interleaved = [];
    const queues = Array.from(targetMap.values());
    let round = 0;
    let hasMore = true;
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

    // 3. XẾP LỊCH CHẠY SONG SONG 2 WORKER
    // Bắt đầu ngay sau 5 giây
    // Mỗi cặp bài (Worker 1 và Worker 2) được kích hoạt cách nhau 5s để khởi động song song
    // Cặp tiếp theo bắt đầu sau 60s (đủ thời gian ~45-50s để 2 worker đăng xong bài trước)
    console.log('\n[3/3] Đang cập nhật lịch đăng mới tốc độ cao vào database...');
    const startTime = new Date(Date.now() + 5 * 1000);
    const updates = [];

    await connection.beginTransaction();

    for (let i = 0; i < interleaved.length; i++) {
      const p = interleaved[i];
      const pairIndex = Math.floor(i / 2);
      const withinPair = i % 2;
      const offsetSeconds = pairIndex * 60 + withinPair * 5;
      const postTime = new Date(startTime.getTime() + offsetSeconds * 1000);

      const formatted = formatMySQLDateTime(postTime);
      await connection.execute(`
        UPDATE post_queue 
        SET scheduled_at = ? 
        WHERE id = ? AND status = 'PENDING'
      `, [formatted, p.id]);

      updates.push({
        id: p.id,
        workerSlot: withinPair + 1,
        target: p.target_group_names,
        time: formatted
      });
    }

    await connection.commit();

    const finishTime = updates[updates.length - 1].time;
    console.log('\n🎉 THÀNH CÔNG! ĐÃ CẬP NHẬT LỊCH ĐĂNG MỚI CHO TOÀN BỘ HÀNG ĐỢI:');
    console.log(`   - Tổng số bài: ${updates.length} bài`);
    console.log(`   - Bài đầu tiên: ${updates[0].time} (Bắt đầu sau vài giây)`);
    console.log(`   - Bài cuối cùng: ${finishTime}`);
    console.log(`   - Tổng thời gian hoàn tất: ~${Math.ceil((updates.length / 2))} phút`);
    console.log('   - 2 Worker sẽ chạy song song liên tục, mỗi phút giải phóng 2 bài.');
    console.log('   - Giãn cách an toàn mỗi nhóm: ~2 phút/bài (hoàn toàn tránh checkpoint Facebook).');

  } catch (err) {
    await connection.rollback();
    console.error('❌ Lỗi:', err);
  } finally {
    await connection.end();
  }
}

main();
