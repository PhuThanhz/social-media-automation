const test = require('node:test');
const assert = require('node:assert');
const browserPool = require('../browserPool');

test('BrowserPool - initial stats structure', (t) => {
  const stats = browserPool.stats();
  assert.ok(typeof stats.browsers === 'number');
  assert.ok(typeof stats.activeContexts === 'number');
  assert.ok(typeof stats.freeMemMb === 'number');
  assert.ok(typeof stats.heapUsedMb === 'number');
  assert.ok(typeof stats.rssMb === 'number');
  assert.ok(stats.freeMemMb > 0, 'free memory should be positive');
});

test('BrowserPool - max configuration limits', (t) => {
  assert.strictEqual(browserPool.maxBrowsers, 2);
  assert.strictEqual(browserPool.maxContextsPerBrowser, 3);
  assert.strictEqual(browserPool.maxTotalContexts, 40);
});

