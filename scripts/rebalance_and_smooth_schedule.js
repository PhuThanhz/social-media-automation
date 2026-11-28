const mysql = require('/Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/worker/node_modules/mysql2/promise');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Rải giờ an toàn:
 * - Giãn cách giữa 2 bài của cùng 1 via: tối thiểu baseGapMins (12 phút)
 * - Giãn cách giữa 2 bài trên CÙNG 1 TARGET: tối thiểu minSameTargetGapMins (30 phút)
 * - Khung giờ hoạt động: từ startTime đến 21:55 tối nay, ngày mai tiếp tục từ 08:00 đến 21:55
 */
function assignSafeTimeline(posts, startTime, baseGapMins = 12, minSameTargetGapMins = 30) {
  let cur = new Date(startTime);
  const lastTimePerTarget = {};

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const target = post.finalTarget;

    // Nếu vượt quá 21:55 hôm nay -> chuyển sang 08:00 sáng mai
    const closeToday = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 21, 55, 0);
    if (cur > closeToday) {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 8, startTime.getMinutes(), 0);
    }

    // Đảm bảo khoảng cách tối thiểu giữa 2 bài trên cùng 1 Fanpage / Profile
    if (lastTimePerTarget[target]) {
      const minAllowed = new Date(lastTimePerTarget[target].getTime() + minSameTargetGapMins * 60 * 1000);
      if (cur < minAllowed) {
        cur = minAllowed;
      }
    }

    // Kiểm tra lại sau khi dịch chuyển có vượt quá 21:55 không
    const closeCheck = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 21, 55, 0);
    if (cur > closeCheck) {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 8, startTime.getMinutes(), 0);
    }

    post.scheduledTime = new Date(cur);
    post.scheduledTimeStr = formatDate(cur);
    lastTimePerTarget[target] = new Date(cur);

    // Mốc bài tiếp theo của via này
    cur = new Date(cur.getTime() + baseGapMins * 60 * 1000);
  }
}

async function main() {
  console.log('================================================================');
  console.log('🚀 ĐIỀU PHỐI VÀ CHIA ĐỀU LỊCH ĐĂNG BÀI TOÀN HỆ THỐNG');
  console.log('================================================================');

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  // 1. Quét toàn bộ bài PENDING
  const [posts] = await conn.query(`
    SELECT id, target_fanpage_id, scheduled_at, title
    FROM post_queue
    WHERE status = 'PENDING'
    ORDER BY id ASC
  `);

  console.log(`\n📊 Tìm thấy tổng cộng ${posts.length} bài viết PENDING.`);
  if (posts.length === 0) {
    console.log('Không có bài viết nào cần xử lý.');
    await conn.end();
    return;
  }

  // 2. Phân trang chuyên biệt cho từng Via để TUYỆT ĐỐI KHÔNG CHỒNG CHÉO:
  // - Via Thành An (c_user: 100023403136194):
  //   + Trang cá nhân Thành An (35)
  //   + Làm Gì Mà Gấp (128)
  //   + Làm phước (127)
  // - Via Huỳnh Thạnh Phú (c_user: 100009194846268):
  //   + Tiệm Len Nhà Phú (152)
  //   + Làm Kinh Tế (129)
  //   + Làm Sen (110)
  //   + Làm Phước Hai (111)
  const remapped = posts.map(p => {
    let target = p.target_fanpage_id;
    if (target.includes('61584834510803')) target = '61584834510803:PERSONAL_COOKIE:110'; // Làm Sen -> Huỳnh Thạnh Phú
    if (target.includes('61589245661782')) target = '61589245661782:PERSONAL_COOKIE:111'; // Làm Phước Hai -> Huỳnh Thạnh Phú
    if (target.includes('61575018530670')) target = '61575018530670:PERSONAL_COOKIE:127'; // Làm phước -> Thành An
    if (target.includes('61551923480422')) target = '61551923480422:PERSONAL_COOKIE:128'; // Làm Gì Mà Gấp -> Thành An
    return { ...p, finalTarget: target };
  });

  const anList = remapped.filter(p => p.finalTarget.endsWith(':35') || p.finalTarget.endsWith(':128') || p.finalTarget.endsWith(':127'));
  const phuList = remapped.filter(p => p.finalTarget.endsWith(':152') || p.finalTarget.endsWith(':129') || p.finalTarget.endsWith(':110') || p.finalTarget.endsWith(':111'));

  console.log(`\n⚖️ Cân bằng 2 nick:`);
  console.log(`  - Via Thành An: ${anList.length} bài`);
  console.log(`  - Via Huỳnh Thạnh Phú: ${phuList.length} bài`);

  // 3. Xen kẽ vòng tròn (Round-Robin) giữa các Fanpage trong mỗi Via
  function interleaveTargets(list) {
    const byTarget = {};
    for (const item of list) {
      if (!byTarget[item.finalTarget]) byTarget[item.finalTarget] = [];
      byTarget[item.finalTarget].push(item);
    }
    const result = [];
    const queues = Object.values(byTarget);
    let maxLen = Math.max(...queues.map(q => q.length));
    for (let r = 0; r < maxLen; r++) {
      for (const q of queues) {
        if (r < q.length) result.push(q[r]);
      }
    }
    return result;
  }

  const sortedAn = interleaveTargets(anList);
  const sortedPhu = interleaveTargets(phuList);

  // 4. Mốc thời gian bắt đầu
  const now = new Date();
  let startAn = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 35, 0);
  if (startAn.getTime() <= now.getTime()) {
    startAn = new Date(now.getTime() + 3 * 60 * 1000);
    startAn.setSeconds(0, 0);
  }
  const startPhu = new Date(startAn.getTime() + 6 * 60 * 1000); // Lệch 6 phút

  assignSafeTimeline(sortedAn, startAn, 12, 30);
  assignSafeTimeline(sortedPhu, startPhu, 12, 30);

  // 5. Cập nhật vào MySQL
  console.log('\n💾 Đang cập nhật dữ liệu vào bảng post_queue...');
  const allUpdates = [...sortedAn, ...sortedPhu];
  for (const item of allUpdates) {
    await conn.query(
      `UPDATE post_queue 
       SET target_fanpage_id = ?, scheduled_at = ?, window_deferred = NULL 
       WHERE id = ?`,
      [item.finalTarget, item.scheduledTimeStr, item.id]
    );
  }
  console.log(`✅ Đã cập nhật thành công ${allUpdates.length} bài viết!`);

  // 6. Thống kê kết quả
  const [summary] = await conn.query(`
    SELECT
      DATE(scheduled_at) as post_date,
      CASE
        WHEN target_fanpage_id LIKE '%:125' OR target_fanpage_id LIKE '%:126' OR target_fanpage_id LIKE '%:127' OR target_fanpage_id LIKE '%:128' OR target_fanpage_id LIKE '%:35' THEN 'Via Thành An'
        WHEN target_fanpage_id LIKE '%:110' OR target_fanpage_id LIKE '%:111' OR target_fanpage_id LIKE '%:90' OR target_fanpage_id LIKE '%:93' OR target_fanpage_id LIKE '%:129' OR target_fanpage_id LIKE '%:152' OR target_fanpage_id LIKE '%:36' THEN 'Via Huỳnh Thạnh Phú'
        ELSE 'Khác'
      END as via_name,
      COUNT(*) as count,
      MIN(TIME(scheduled_at)) as earliest,
      MAX(TIME(scheduled_at)) as latest
    FROM post_queue
    WHERE status = 'PENDING'
    GROUP BY post_date, via_name
    ORDER BY post_date, via_name
  `);

  console.log('\n📊 BẢNG PHÂN BỔ LỊCH ĐĂNG THEO NGÀY VÀ VIA:');
  console.table(summary);

  // Thống kê từng fanpage
  const [fanpageStats] = await conn.query(`
    SELECT 
      CASE 
        WHEN pq.target_fanpage_id LIKE 'PERSONAL_PROFILE%' THEN 'Trang cá nhân Thành An'
        ELSE sa.page_name
      END as page_name,
      pq.target_fanpage_id,
      COUNT(*) as post_count,
      MIN(TIME(scheduled_at)) as first_post_time,
      MAX(TIME(scheduled_at)) as last_post_time
    FROM post_queue pq
    LEFT JOIN social_accounts sa ON (
      sa.id = SUBSTRING_INDEX(pq.target_fanpage_id, ':', -1)
      OR (pq.target_fanpage_id LIKE 'PERSONAL_PROFILE%' AND sa.id = 35)
    )
    WHERE pq.status = 'PENDING'
    GROUP BY pq.target_fanpage_id, page_name
    ORDER BY page_name ASC
  `);

  console.log('\n📌 BẢNG THỐNG KÊ CHI TIẾT TỪNG TARGET / FANPAGE:');
  console.table(fanpageStats);

  await conn.end();
}

main().catch(err => {
  console.error('Lỗi thực thi:', err);
  process.exit(1);
});
