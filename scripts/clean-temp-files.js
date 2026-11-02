const fs = require('fs');
const path = require('path');
const mysql = require('../worker/node_modules/mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`=== BẮT ĐẦU DỌN DẸP DUNG LƯỢNG FILE TẠM (${DRY_RUN ? 'CHẾ ĐỘ THỬ NGHIỆM --dry-run' : 'CHẾ ĐỘ XÓA THẬT'}) ===`);

  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '26082003',
    database: 'autopost_saas'
  });

  try {
    // 1. Thu thập toàn bộ media_urls còn đang dùng (PENDING, PROCESSING hoặc đăng trong 7 ngày gần đây)
    const [rows] = await connection.execute(`
      SELECT media_urls FROM post_queue 
      WHERE status IN ('PENDING', 'PROCESSING') 
         OR scheduled_at >= NOW() - INTERVAL 7 DAY 
         OR published_at >= NOW() - INTERVAL 7 DAY
    `);

    const referencedFiles = new Set();
    for (const row of rows) {
      if (!row.media_urls) continue;
      const urls = row.media_urls.split(',');
      for (const rawUrl of urls) {
        const u = rawUrl.trim();
        if (!u) continue;
        const basename = path.basename(u.split('?')[0]);
        if (basename) referencedFiles.add(basename);
      }
    }
    console.log(`[DB] Đã quét được ${referencedFiles.size} file đang được bài viết chờ đăng hoặc bài mới tham chiếu.`);

    let totalDeletedBytes = 0;
    let totalDeletedCount = 0;

    // 2. Dọn backend/uploads/
    const uploadsDir = path.join(__dirname, '../backend/uploads');
    if (fs.existsSync(uploadsDir)) {
      const uploadFiles = fs.readdirSync(uploadsDir);
      for (const file of uploadFiles) {
        const filePath = path.join(uploadsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue; // Bỏ qua thư mục như bgm/

        // Bỏ qua file đang được tham chiếu
        if (referencedFiles.has(file)) continue;

        // Các loại file tạm cần dọn:
        // - vs-src-*.mp4 (file nguồn video studio đã cào/render xong)
        // - vs-video-*.mp4 (file video studio render cũ không dùng)
        // - reddit_*.mp4 (clip reddit tạm)
        // - newscard-*.png hoặc UUID cũ hơn 3 ngày và KHÔNG có trong DB
        const ageMs = Date.now() - stat.mtimeMs;
        const isOldEnough = ageMs > 24 * 60 * 60 * 1000; // Cũ hơn 24 giờ

        const isTempFile = file.startsWith('vs-src-') 
          || file.startsWith('vs-video-') 
          || file.startsWith('reddit_') 
          || file.startsWith('newscard-video-')
          || (file.startsWith('newscard-') && ageMs > 3 * 24 * 60 * 60 * 1000)
          || stat.size > 5 * 1024 * 1024; // Các file video lớn > 5MB không dùng

        if (isTempFile && isOldEnough) {
          totalDeletedBytes += stat.size;
          totalDeletedCount++;
          console.log(`[Uploads] ${DRY_RUN ? '[XEM TRƯỚC]' : '[ĐÃ XÓA]'} ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
          if (!DRY_RUN) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    // 3. Dọn worker/downloads/clip_meo/
    const clipMeoDir = path.join(__dirname, '../worker/downloads/clip_meo');
    if (fs.existsSync(clipMeoDir)) {
      const clipFiles = fs.readdirSync(clipMeoDir);
      for (const file of clipFiles) {
        const filePath = path.join(clipMeoDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue;

        if (referencedFiles.has(file)) continue;

        const ageMs = Date.now() - stat.mtimeMs;
        const isOldEnough = ageMs > 2 * 24 * 60 * 60 * 1000; // Cũ hơn 48 giờ

        if (isOldEnough) {
          totalDeletedBytes += stat.size;
          totalDeletedCount++;
          console.log(`[ClipMeo] ${DRY_RUN ? '[XEM TRƯỚC]' : '[ĐÃ XÓA]'} ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
          if (!DRY_RUN) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    console.log(`\n=== TỔNG KẾT: ${DRY_RUN ? 'Dự kiến giải phóng' : 'Đã giải phóng thành công'} ${(totalDeletedBytes / 1024 / 1024).toFixed(2)} MB (${totalDeletedCount} file)! ===`);
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Lỗi khi dọn dẹp:', err);
  process.exit(1);
});
