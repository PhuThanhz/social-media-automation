const { chromium } = require('playwright');
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'autopost_saas'
  }).catch(async () => {
    return await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      port: 3306,
      database: 'autopost_saas'
    });
  });

  const [rows] = await conn.execute("SELECT access_token, page_name FROM social_accounts WHERE page_name LIKE '%Làm Sen%' AND access_token LIKE '%c_user%' LIMIT 1");
  await conn.end();

  if (!rows || rows.length === 0) {
    console.log('No cookie found');
    return;
  }

  const cookieStr = rows[0].access_token;
  console.log('Using cookie from account:', rows[0].page_name);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  // parse cookies
  const cookies = cookieStr.split(';').map(c => {
    const [name, ...val] = c.trim().split('=');
    return {
      name,
      value: val.join('='),
      domain: '.facebook.com',
      path: '/'
    };
  }).filter(c => c.name && c.value);

  await context.addCookies(cookies);
  const page = await context.newPage();

  const searchUrl = 'https://www.facebook.com/search/groups/?q=' + encodeURIComponent('review phim');
  console.log('Navigating to:', searchUrl);
  await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('goto err:', e.message));

  await page.waitForTimeout(4000);

  // Extract groups
  const groups = await page.evaluate(() => {
    const results = [];
    const main = document.querySelector('[role="main"]') || document.body;
    const links = Array.from(main.querySelectorAll('a[href*="/groups/"]'));
    const seen = new Set();

    for (const a of links) {
      const href = a.href || '';
      // Exclude generic group URLs
      const match = href.match(/https:\/\/(?:www\.)?facebook\.com\/groups\/([A-Za-z0-9._-]+)(?:\/|\?|$)/);
      if (!match) continue;
      const slugOrId = match[1];
      if (['feed', 'discover', 'joins', 'create', 'search'].includes(slugOrId.toLowerCase())) continue;
      
      const cleanUrl = `https://www.facebook.com/groups/${slugOrId}/`;
      if (seen.has(cleanUrl)) continue;

      // Group card container
      const card = a.closest('div[role="article"]') || a.closest('div[data-virtualized]') || a.closest('div.x1yztbdb') || a.parentElement;
      const text = (card?.innerText || a.innerText || '').trim();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const name = a.innerText.trim() || lines[0] || slugOrId;

      if (!name || name.length < 3) continue;

      // Search for members count like "150K thành viên" or "10 bài viết/ngày"
      const memberLine = lines.find(l => /thành viên|members/i.test(l)) || '';
      const postFreqLine = lines.find(l => /bài viết\/ngày|posts a day|bài viết\/tháng/i.test(l)) || '';
      const privacy = /công khai|public/i.test(text) ? 'Công khai' : (/riêng tư|private/i.test(text) ? 'Riêng tư' : 'Công khai');

      // image
      const img = card?.querySelector('img')?.src || '';

      seen.add(cleanUrl);
      results.push({
        id: slugOrId,
        name,
        url: cleanUrl,
        memberLine,
        postFreqLine,
        privacy,
        avatar: img,
        previewText: lines.slice(0, 4).join(' • ')
      });
      if (results.length >= 15) break;
    }
    return results;
  });

  console.log('Found groups:', JSON.stringify(groups, null, 2));
  await browser.close();
}

main().catch(console.error);
