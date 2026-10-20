const fs = require('fs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright');
const BMS = { '325356104925729': 'Kisserine', '575111961273013': 'Thudong' };
function walk(o, out, path = '') {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach((x) => walk(x, out, path));
  if (typeof o.id === "string" && /^\d{9,}$/.test(o.id)) out.push({ id: o.id, name: typeof o.name === 'string' ? o.name : '', type: o.__typename || '', assigned: o.assigned_users ? o.assigned_users.has_at_least_one : undefined, keys: Object.keys(o).join(','), raw: o });
  for (const k of Object.keys(o)) walk(o[k], out, path + '.' + k);
}
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT||3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [rows] = await conn.execute("SELECT access_token FROM social_accounts WHERE id=96"); await conn.end();
  const cookies = rows[0].access_token.split(';').map(s => s.trim()).filter(Boolean).map(kv => { const i = kv.indexOf('='); return { name: kv.slice(0,i), value: kv.slice(i+1), domain: '.facebook.com', path: '/', secure: true }; });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', viewport: { width: 1500, height: 1000 } });
  await ctx.addCookies(cookies);
  const result = {};
  for (const [bid, bname] of Object.entries(BMS)) {
    const p = await ctx.newPage();
    const found = [];
    p.on('response', async (r) => {
      if (!r.url().includes('/api/graphql')) return;
      try { const t = await r.text(); for (const line of t.split('\n')) { try { walk(JSON.parse(line), found); } catch {} } } catch {}
    });
    await p.goto(`https://business.facebook.com/latest/settings/pages?business_id=${bid}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(8000);
    let last = -1, stale = 0;
    for (let i = 0; i < 250 && stale < 8; i++) {
      await p.evaluate(() => { const g = document.querySelector('table[role="grid"]'); let el = g; while (el && el.scrollHeight <= el.clientHeight + 5) el = el.parentElement; if (el) el.scrollTop = el.scrollHeight; });
      await p.mouse.move(600, 600); await p.mouse.wheel(0, 3000);
      await p.waitForTimeout(1200);
      const ids = new Set(found.map((f) => f.id)).size;
      if (ids === last) stale++; else { stale = 0; last = ids; }
    }
    const byId = new Map();
    for (const f of found) { const c = byId.get(f.id) || { id: f.id, name: '', type: '', assigned: undefined, keys: '' }; if (f.name && !c.name) c.name = f.name; if (f.type && !c.type) c.type = f.type; if (f.assigned !== undefined) c.assigned = f.assigned; c.keys += '|' + f.keys; byId.set(f.id, c); }
    for (const c of byId.values()) if (!c.type && c.keys.includes('assigned_users')) c.type = 'Page';
    const pagesArr=[...byId.values()].filter(c=>c.type==='Page'); const types={pages: pagesArr.length, named: pagesArr.filter(c=>c.name).length, assigned: pagesArr.filter(c=>c.assigned).length};
    console.log(`\n== ${bname}: ${byId.size} objects`); console.log(types);
    result[bid] = [...byId.values()].filter((c) => c.type === 'Page').map(({ keys, ...x }) => x);
    await p.close();
  }
  fs.writeFileSync('scratch/_bm_scan_out.json', JSON.stringify(result, null, 1));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
