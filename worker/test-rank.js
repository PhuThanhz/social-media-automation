const { searchFacebookGroups } = require('./fb-group-search');
const http = require('http');

async function getCookie() {
  return new Promise((resolve) => {
    http.get('http://localhost:8081/api/connections', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const acc = list.find(a => a.id === 110 || a.id === 7);
          resolve(acc?.accessToken || '');
        } catch(e) { resolve(''); }
      });
    }).on('error', () => resolve(''));
  });
}

async function run() {
  const cookieString = await getCookie();
  const res = await searchFacebookGroups({ keyword: 'review phim', cookieString, limit: 10 });
  console.log('Result count:', res.groups.length);
  res.groups.forEach((g, idx) => {
    console.log(`#${idx + 1}: ${g.name} | Score: ${g.qualityScore} | Members: ${g.memberCount} (${g.memberLine}) | Posts: ${g.postsPerDay} (${g.postFreqLine}) | Privacy: ${g.privacy}`);
  });
}

run().catch(console.error);
