// Trích xuất danh sách Group Facebook theo Từ khoá (Facebook Group Search) & Xếp hạng Chất Lượng
const { chromium } = require('playwright');

function parseMemberCount(text) {
  if (!text) return 0;
  const match = text.match(/([\d.,]+)\s*([kKmMtrTriệu]+)?\s*thành viên/i);
  if (!match) return 0;
  let val = parseFloat(match[1].replace(',', '.'));
  const unit = (match[2] || '').toLowerCase();
  if (unit.includes('m') || unit.includes('tr') || unit.includes('triệu')) {
    return Math.round(val * 1000000);
  }
  if (unit.includes('k')) {
    return Math.round(val * 1000);
  }
  return Math.round(val);
}

function parsePostsPerDay(text) {
  if (!text) return 0;
  const match = text.match(/(\d+)\+?\s*bài viết\/(ngày|day)/i);
  if (match) return parseInt(match[1], 10);
  const monthMatch = text.match(/(\d+)\+?\s*bài viết\/(tháng|month)/i);
  if (monthMatch) return Math.round(parseInt(monthMatch[1], 10) / 30);
  return 0;
}

async function searchFacebookGroups({ keyword = '', cookieString = '', limit = 20, minMembers = 0 }) {
  const trimmed = (keyword || '').trim();
  if (!trimmed) {
    return { success: false, error: 'Vui lòng nhập từ khoá tìm kiếm nhóm!', groups: [] };
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });

    // Cài đặt cookie nếu có
    if (cookieString && cookieString.includes('c_user')) {
      const cookies = cookieString.split(';').map(c => {
        const [name, ...val] = c.trim().split('=');
        return {
          name,
          value: val.join('='),
          domain: '.facebook.com',
          path: '/'
        };
      }).filter(c => c.name && c.value);
      await context.addCookies(cookies);
    }

    const page = await context.newPage();
    const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(trimmed)}`;
    console.log(`[FB_Group_Search] Đang tìm kiếm nhóm Facebook theo từ khoá: "${trimmed}"`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const targetLimit = Math.min(Math.max(Number(limit) || 25, 10), 100);
    const collectedMap = new Map();
    let noNewCount = 0;
    // Cho phép cuộn đủ nhiều lần để load được tới 80 - 100 nhóm
    const maxScrolls = Math.max(Math.ceil(targetLimit / 1.5), 30);

    for (let scroll = 0; scroll < maxScrolls; scroll++) {
      const batch = await page.evaluate(() => {
        const results = [];
        const main = document.querySelector('[role="main"]') || document.body;
        const links = Array.from(main.querySelectorAll('a[href*="/groups/"]'));

        for (const a of links) {
          const href = a.href || '';
          const match = href.match(/https:\/\/(?:www\.)?facebook\.com\/groups\/([A-Za-z0-9._-]+)(?:\/|\?|$)/);
          if (!match) continue;
          const slugOrId = match[1];
          if (['feed', 'discover', 'joins', 'create', 'search'].includes(slugOrId.toLowerCase())) continue;

          const cleanUrl = `https://www.facebook.com/groups/${slugOrId}/`;
          const card = a.closest('div[role="article"]') || a.closest('div[data-virtualized]') || a.closest('div.x1yztbdb') || a.parentElement;
          const text = (card?.innerText || a.innerText || '').trim();
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const name = a.innerText.trim() || lines[0] || slugOrId;

          if (!name || name.length < 3) continue;

          // Tách sạch thông tin từ dòng mô tả Facebook (VD: "Công khai · 706K thành viên · 70+ bài viết/ngày")
          const rawSubtitle = lines.find(l => /thành viên|members/i.test(l)) || text;
          let memberLine = '';
          let postFreqLine = '';

          const parts = rawSubtitle.split(/[·•]/).map(p => p.trim());
          for (const p of parts) {
            if (/thành viên|members/i.test(p)) {
              memberLine = p;
            } else if (/bài viết|posts/i.test(p)) {
              postFreqLine = p;
            }
          }

          if (!memberLine) {
            const matchM = rawSubtitle.match(/[\d.,]+[KkMm]?\s*(?:thành viên|members)/i);
            memberLine = matchM ? matchM[0] : 'Cộng đồng Facebook';
          }
          if (!postFreqLine) {
            const matchP = rawSubtitle.match(/[\d+]+\s*(?:bài viết|posts)\s*\/\s*(?:ngày|tháng|day|month)/i);
            postFreqLine = matchP ? matchP[0] : '';
          }

          const privacy = /riêng tư|private/i.test(text) ? 'Riêng tư' : 'Công khai';
          const img = card?.querySelector('img')?.src || '';

          results.push({
            id: slugOrId,
            name,
            url: cleanUrl,
            memberLine: memberLine || 'Cộng đồng Facebook',
            postFreqLine: postFreqLine || '',
            privacy,
            avatar: img,
          });
        }
        return results;
      });

      let addedThisTurn = 0;
      for (const g of batch) {
        if (!collectedMap.has(g.url)) {
          collectedMap.set(g.url, g);
          addedThisTurn++;
        }
      }

      if (collectedMap.size >= targetLimit) {
        console.log(`[FB_Group_Search] 🎯 Đã tích luỹ đủ ${collectedMap.size}/${targetLimit} nhóm theo yêu cầu.`);
        break;
      }

      if (addedThisTurn === 0) {
        noNewCount++;
        if (noNewCount >= 5) {
          console.log(`[FB_Group_Search] ℹ️ Đã cuộn 5 lần liên tiếp không có thêm nhóm mới (Facebook đã hết kết quả tìm kiếm). Dừng ở ${collectedMap.size} nhóm.`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      // Cuộn xuống để kích hoạt Facebook tải thêm nhóm
      await page.evaluate(() => {
        window.scrollBy(0, 1600);
        if (document.documentElement) document.documentElement.scrollTop += 1600;
        if (document.body) document.body.scrollTop += 1600;
      });
      await page.waitForTimeout(800);
    }

    const rawGroups = Array.from(collectedMap.values());

    await browser.close();
    browser = null;

    // Đánh giá và chấm điểm chất lượng (Quality Score)
    const evaluatedGroups = rawGroups.map((g) => {
      const memberCount = parseMemberCount(g.memberLine);
      const postsPerDay = parsePostsPerDay(g.postFreqLine || g.memberLine);
      
      let qualityScore = 0;
      // Điểm theo quy mô thành viên
      if (memberCount >= 500000) qualityScore += 50;
      else if (memberCount >= 200000) qualityScore += 40;
      else if (memberCount >= 100000) qualityScore += 30;
      else if (memberCount >= 50000) qualityScore += 18;
      else if (memberCount >= 20000) qualityScore += 8;
      else qualityScore -= 10;

      // Điểm theo tần suất hoạt động
      if (postsPerDay >= 50) qualityScore += 30;
      else if (postsPerDay >= 20) qualityScore += 20;
      else if (postsPerDay >= 5) qualityScore += 10;

      // Nhóm Công khai dễ cào hơn
      if (g.privacy === 'Công khai') qualityScore += 20;

      // Phạt điểm các nhóm rác / nhóm thanh lý / tìm đồ lạc / từ thiện cứu trợ (không phải nhóm nội dung giải trí/review)
      const lowerName = g.name.toLowerCase();
      const isNegative = /thất lạc|tìm chó|tìm mèo lạc|cứu trợ|cho tặng|thanh lý|mua bán|nhận nuôi|tuyển dụng|việc làm|phòng trọ/i.test(lowerName);
      const userSearchedNegative = /thất lạc|cứu trợ|mua bán|thanh lý|việc làm/i.test(trimmed);
      if (isNegative && !userSearchedNegative) {
        qualityScore -= 35;
      }

      // Xác định huy hiệu chất lượng
      let qualityBadge = '';
      if (memberCount >= 500000) qualityBadge = '👑 Siêu Group Khủng';
      else if (memberCount >= 200000) qualityBadge = '🔥 Top Cộng Đồng Lớn';
      else if (memberCount >= 100000) qualityBadge = '⭐ Nhóm Uy Tín (>100K)';
      else if (postsPerDay >= 50) qualityBadge = '⚡ Hoạt Động Cực Sôi Nổi';

      return {
        ...g,
        memberCount,
        postsPerDay,
        qualityScore,
        qualityBadge,
        isHighQuality: qualityScore >= 40 && memberCount >= 50000,
      };
    });

    // Lọc và Sắp xếp: Nhóm có điểm chất lượng cao & thành viên đông nhất lên hàng đầu
    evaluatedGroups.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return b.memberCount - a.memberCount;
    });

    let finalGroups = evaluatedGroups;
    if (minMembers > 0) {
      finalGroups = finalGroups.filter((g) => !g.memberCount || g.memberCount >= minMembers);
    }

    finalGroups = finalGroups.slice(0, targetLimit);

    console.log(`[FB_Group_Search] ✅ Tìm thấy ${finalGroups.length} nhóm khớp từ khoá "${trimmed}" (Đã xếp hạng chất lượng)`);
    return {
      success: true,
      keyword: trimmed,
      total: finalGroups.length,
      groups: finalGroups
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[FB_Group_Search] ❌ Lỗi tìm nhóm:', err.message);
    return {
      success: false,
      error: `Lỗi khi tìm nhóm Facebook: ${err.message}`,
      groups: []
    };
  }
}

module.exports = { searchFacebookGroups };
