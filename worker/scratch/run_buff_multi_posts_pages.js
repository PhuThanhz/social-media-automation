const mysql = require('mysql2/promise');
const fbBuffTool = require('../fb-buff-tool');

function extractCUser(cookieStr) {
  if (!cookieStr) return null;
  const match = cookieStr.match(/(?:^|;\s*)c_user=([0-9]+)/);
  return match ? match[1] : null;
}

const TARGET_POSTS = [
  'https://www.facebook.com/share/p/1GnyVf2sbM/',
  'https://www.facebook.com/share/p/19ivmH7zUw/',
  'https://www.facebook.com/share/p/1Ht3AbmdjY/'
];

(async () => {
  console.log(`=== BẮT ĐẦU BUFF LIKE CHO ${TARGET_POSTS.length} BÀI VIẾT BẰNG TOÀN BỘ FANPAGE CỦA MỖI VIA ===\n`);
  TARGET_POSTS.forEach((url, idx) => console.log(` [Bài ${idx + 1}]: ${url}`));
  console.log('-----------------------------------------------------\n');

  const db = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas',
  });

  const [rows] = await db.query(
    "SELECT id, access_token FROM social_accounts WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE')"
  );
  await db.end();

  // Map each distinct c_user (Via) to its cookie
  const viaMap = new Map();
  for (const row of rows) {
    const cookie = row.access_token || '';
    const cUser = extractCUser(cookie);
    if (!cUser) continue;
    if (!viaMap.has(cUser)) {
      viaMap.set(cUser, { cookie, uid: cUser, pages: [] });
    }
  }

  const vias = Array.from(viaMap.values());
  console.log(`Tìm thấy ${vias.length} Via trong hệ thống:`, vias.map(v => v.uid).join(', '));

  // Bước 1: Quét danh sách fanpage cho từng Via (nếu chưa có) và cache lại
  console.log('\n🔍 Đang chuẩn bị danh sách Fanpage cho từng Via...');
  for (const via of vias) {
    try {
      const pages = await fbBuffTool.getManagedPages(via.cookie);
      via.pages = pages;
      console.log(`  -> Via ${via.uid}: Quét được ${pages.length} Fanpage.`);
    } catch (err) {
      console.warn(`  -> Via ${via.uid}: Không quét được page (${err.message}).`);
      via.pages = [];
    }
  }

  const activeViasWithPages = vias.filter(v => v.pages && v.pages.length > 0);
  const totalPagesAll = activeViasWithPages.reduce((sum, v) => sum + v.pages.length, 0);
  console.log(`\n✅ Tổng cộng có ${activeViasWithPages.length} Via hợp lệ với ${totalPagesAll} Fanpage sẵn sàng buff like!`);
  console.log('-----------------------------------------------------\n');

  const grandSummary = [];

  // Bước 2: Chạy buff like lần lượt cho từng bài viết
  for (let postIdx = 0; postIdx < TARGET_POSTS.length; postIdx++) {
    const targetUrl = TARGET_POSTS[postIdx];
    console.log(`\n======================================================`);
    console.log(`🚀 BẮT ĐẦU BUFF BÀI [${postIdx + 1}/${TARGET_POSTS.length}]: ${targetUrl}`);
    console.log(`======================================================`);

    let postSuccess = 0;
    let postTotal = 0;

    for (let viaIdx = 0; viaIdx < activeViasWithPages.length; viaIdx++) {
      const via = activeViasWithPages[viaIdx];
      console.log(`\n▶️ [Bài ${postIdx + 1}] [Via ${viaIdx + 1}/${activeViasWithPages.length}] UID: ${via.uid} (${via.pages.length} fanpage)...`);

      try {
        const result = await fbBuffTool.buffLikesWithPages(via.cookie, targetUrl, {
          reactionType: 'LIKE',
          selectedPages: via.pages, // Dùng danh sách page đã cache để chạy nhanh và mượt
          delayMs: 1500,
          enableLike: true,
          enableComment: false,
          enableHumanBehavior: true,
        });

        const successCount = result.success || 0;
        const total = result.total || via.pages.length;
        postSuccess += successCount;
        postTotal += total;
        console.log(` ✅ Xong Via ${via.uid}: ${successCount}/${total} fanpage thành công.`);
      } catch (err) {
        console.error(` ❌ Lỗi Via ${via.uid} trên bài ${postIdx + 1}: ${err.message}`);
      }

      if (viaIdx < activeViasWithPages.length - 1) {
        console.log('⏳ Nghỉ an toàn 3s trước Via tiếp theo...');
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    grandSummary.push({
      postIndex: postIdx + 1,
      targetUrl,
      successCount: postSuccess,
      totalCount: postTotal,
      status: postSuccess > 0 ? 'SUCCESS' : 'FAILED',
    });

    console.log(`\n🏁 Hoàn thành Bài [${postIdx + 1}/${TARGET_POSTS.length}]: ${postSuccess}/${postTotal} Like thành công!`);

    if (postIdx < TARGET_POSTS.length - 1) {
      console.log('⏳ Nghỉ an toàn 5 giây trước khi chuyển sang bài tiếp theo...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n======================================================');
  console.log('🎉 TỔNG KẾT BUFF LIKE CHO TẤT CẢ CÁC BÀI VIẾT:');
  console.log('======================================================');
  console.table(grandSummary);
  const totalAllLikes = grandSummary.reduce((sum, item) => sum + item.successCount, 0);
  console.log(`\n🎯 ĐÃ HOÀN TẤT: Tổng cộng ${totalAllLikes} lượt like bằng Fanpage cho cả 3 bài viết!`);
})().catch(console.error);
