const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

async function testTikTok(keyword) {
  console.log('Testing TikTok for keyword:', keyword);
  // Try TikTok hashtag or search
  const clean = keyword.replace(/^#/, '').trim();
  const tagUrl = `https://www.tiktok.com/tag/${encodeURIComponent(clean)}`;
  console.log('Testing URL:', tagUrl);

  const ytArgs = [
    '-m', 'yt_dlp',
    '--flat-playlist',
    '--dump-json',
    '--playlist-items', '1-5',
    tagUrl,
  ];

  try {
    const { stdout } = await execFileAsync('python3', ytArgs, { timeout: 30000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    console.log(`Found ${lines.length} lines from yt-dlp:`);
    for (const l of lines.slice(0, 2)) {
      const it = JSON.parse(l);
      console.log('Sample:', { id: it.id, title: it.title, uploader: it.uploader, view_count: it.view_count, url: it.webpage_url });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testTikTok('review');
