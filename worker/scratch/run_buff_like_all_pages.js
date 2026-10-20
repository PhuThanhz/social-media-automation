const mysql = require('mysql2/promise');
const fbBuffTool = require('../fb-buff-tool');

function extractCUser(cookieStr) {
  if (!cookieStr) return null;
  const match = cookieStr.match(/(?:^|;\s*)c_user=([0-9]+)/);
  return match ? match[1] : null;
}

(async () => {
  const targetUrl = 'https://www.facebook.com/share/p/19gct7Ascw/';
  console.log(`=== BẮT ĐẦU BUFF LIKE CHO TẤT CẢ FANPAGE CỦA MỖI VIA: ${targetUrl} ===\n`);

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
      viaMap.set(cUser, { cookie, uid: cUser });
    }
  }

  const vias = Array.from(viaMap.values());
  console.log(`Tìm thấy ${vias.length} Via có fanpage để buff:`, vias.map(v => v.uid).join(', '));
  console.log('-----------------------------------------------------\n');

  const summary = [];

  for (let i = 0; i < vias.length; i++) {
    const via = vias[i];
    console.log(`\n▶️ [${i + 1}/${vias.length}] Đang buff like cho Via UID: ${via.uid}...`);
    try {
      const result = await fbBuffTool.buffLikesWithPages(via.cookie, targetUrl, {
        reactionType: 'LIKE',
        delayMs: 1500,
        enableLike: true,
        enableComment: false,
        // selectedPages omitted => tool will auto‑scan all fanpage/personal page under this Via
      });

      const successCount = result.success || 0;
      const total = result.total || 0;
      const status = successCount === total ? 'SUCCESS' : 'PARTIAL';
      console.log(` Kết quả Via ${via.uid}: ${successCount}/${total} fanpage thành công (${status})`);
      summary.push({ uid: via.uid, total, success: successCount, status });
    } catch (err) {
      console.error(` ❌ Lỗi trên Via ${via.uid}: ${err.message}`);
      summary.push({ uid: via.uid, total: 0, success: 0, status: 'FAILED', error: err.message });
    }

    if (i < vias.length - 1) {
      console.log('⏳ Nghỉ an toàn 3 giây trước Via tiếp theo...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n================ TỔNG KẾT BUFF LIKE (TẤT CẢ FANPAGE) ================');
  console.table(summary);
  const overallSuccess = summary.reduce((sum, s) => sum + s.success, 0);
  const overallTotal = summary.reduce((sum, s) => sum + s.total, 0);
  console.log(`\n🎉 Tổng cộng: ${overallSuccess}/${overallTotal} fanpage đã thả Like thành công!`);
})().catch(console.error);
