const { chromium } = require('playwright');
const mysql = require('mysql2/promise');

async function testFbSearch() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '26082003',
    database: 'autopost_saas',
  });
  const [rows] = await connection.execute('SELECT access_token FROM social_accounts WHERE account_type = "PERSONAL_COOKIE" AND token_status = "OK" AND access_token IS NOT NULL LIMIT 1');
  await connection.end();

  const cookieStr = rows[0]?.access_token;
  if (!cookieStr) {
    console.log('No cookie found');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const cookies = cookieStr.split(';').map(p => {
    const [k, ...v] = p.trim().split('=');
    return { name: k, value: v.join('='), domain: '.facebook.com', path: '/' };
  }).filter(c => c.name && c.value);

  await context.addCookies(cookies);
  const page = await context.newPage();

  const searchUrl = 'https://www.facebook.com/search/posts/?q=' + encodeURIComponent('mèo cưng');
  console.log('Navigating to', searchUrl);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(4000);
  const title = await page.title();
  console.log('Title:', title);

  const posts = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="multi_permalinks="]'));
    return links.slice(0, 5).map(a => a.href);
  });
  console.log('Found FB post links:', posts);
  await browser.close();
}

testFbSearch();
