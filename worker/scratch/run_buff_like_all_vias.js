const mysql = require('mysql2/promise');
const path = require('path');
const fbBuffTool = require('../fb-buff-tool');

function extractCUser(cookieStr) {
  if (!cookieStr) return null;
  const match = cookieStr.match(/(?:^|;\s*)c_user=([0-9]+)/);
  return match ? match[1] : null;
}

(async () => {
  const targetUrl = 'https://www.facebook.com/share/p/17oUGXyx3R/';
  console.log(`=== BẮT ĐẦU BUFF LIKE TOÀN BỘ VIA CHO BÀI VIẾT: ${targetUrl} ===\n`);

  const db = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas'
  });

  const [rows] = await db.query(
    "SELECT id, platform, platform_account_id, page_name, account_type, access_token, token_status FROM social_accounts WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE')"
  );
  await db.end();

  // Danh sách các via duy nhất theo c_user
  const viaMap = new Map();

  for (const row of rows) {
    const cookie = row.access_token || '';
    const cUser = extractCUser(cookie);
    if (!cUser) continue;

    // Ưu tiên bản ghi profile hoặc token_status OK
    const isProfile = row.platform === 'FACEBOOK_PROFILE' || row.account_type === 'PERSONAL_PROFILE_COOKIE';
    const existing = viaMap.get(cUser);

    if (!existing || (isProfile && !existing.isProfile)) {
      viaMap.set(cUser, {
        id: row.id,
        uid: cUser,
        name: row.page_name || `Via ${cUser}`,
        cookie: cookie,
        isProfile: isProfile,
      });
    }
  }

  const vias = Array.from(viaMap.values());
  console.log(`Tìm thấy ${vias.length} tài khoản Via cá nhân hợp lệ:`);
  vias.forEach((v, idx) => {
    console.log(` ${idx + 1}. [UID: ${v.uid}] ${v.name} (DB id: ${v.id})`);
  });
  console.log('-----------------------------------------------------\n');

  const summary = [];

  for (let i = 0; i < vias.length; i++) {
    const via = vias[i];
    console.log(`\n▶️ [${i + 1}/${vias.length}] Đang buff like với Via: ${via.name} (UID: ${via.uid})...`);

    try {
      const res = await fbBuffTool.buffLikesWithPages(via.cookie, targetUrl, {
        reactionType: 'LIKE',
        selectedPages: [
          {
            id: via.uid,
            name: via.name,
            isProfile: true,
          }
        ],
        delayMs: 1500,
        enableLike: true,
        enableComment: false,
      });

      const detail = (res.details && res.details[0]) || {};
      const status = detail.likeStatus || (res.success > 0 ? 'SUCCESS' : 'FAILED');
      const err = detail.likeError || detail.error || '';

      console.log(` Kết quả: ${status} ${err ? `(Lỗi: ${err})` : ''}`);
      summary.push({
        name: via.name,
        uid: via.uid,
        status: status,
        error: err
      });
    } catch (err) {
      console.error(` ❌ Thất bại với Via ${via.name}: ${err.message}`);
      summary.push({
        name: via.name,
        uid: via.uid,
        status: 'FAILED',
        error: err.message
      });
    }

    if (i < vias.length - 1) {
      console.log('⏳ Nghỉ an toàn 3 giây trước Via tiếp theo...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n================ TỔNG KẾT BUFF LIKE ================');
  console.table(summary);
  const successCount = summary.filter(s => s.status === 'SUCCESS' || s.status === 'ALREADY_LIKED').length;
  console.log(`\n🎉 Hoàn thành: ${successCount}/${vias.length} Via đã thả Like thành công!`);
})().catch(console.error);
