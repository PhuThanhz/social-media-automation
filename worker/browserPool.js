const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Flag giảm RAM/IO dùng chung cho mọi Chromium do pool khởi động.
const LOW_MEMORY_BROWSER_ARGS = [
  '--disk-cache-size=33554432',
  '--media-cache-size=33554432',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-translate',
  '--disable-sync',
  '--js-flags=--max-old-space-size=768',
  // Ẩn navigator.webdriver — các luồng scrape/hunt/buff Facebook trước đây đều tự launch với cờ này.
  '--disable-blink-features=AutomationControlled',
];

/**
 * Pool tái sử dụng PROCESS Chromium giữa nhiều request thay vì chromium.launch() mới mỗi lần (tốn
 * ~1-3s khởi động + ~150-300MB RAM/lần). Mỗi lần đăng bài vẫn tạo 1 browser CONTEXT mới hoàn toàn
 * (cookie/session riêng biệt theo account, KHÔNG share giữa các lần đăng khác account) và luôn
 * context.close() ngay sau khi dùng xong — chỉ có process Chromium bên dưới được tái sử dụng.
 *
 * Rollout: chỉ áp dụng cho 1 route phụ (ít rủi ro) trước, KHÔNG đổi /api/post-facebook hay các route
 * đăng bài chính cho tới khi route thử nghiệm này chạy ổn định nhiều ngày liên tục.
 */
class BrowserPool {
  constructor({ maxBrowsers = 2, maxContextsPerBrowser = 3, maxTotalContexts = 40, idleTimeoutMs = 5 * 60_000, watchdogIntervalMs = 60_000 } = {}) {
    this.maxBrowsers = maxBrowsers;
    this.maxContextsPerBrowser = maxContextsPerBrowser;
    this.maxTotalContexts = maxTotalContexts;
    this.idleTimeoutMs = idleTimeoutMs;
    this.entries = []; // { browser, activeContexts, lastUsedAt, totalContextsCreated }
    this.waiters = []; // resolve callbacks chờ có slot trống
    // Khoá tuần tự (mutex) quanh bước "tìm slot trống / tạo browser mới" — bắt buộc phải có vì
    // nhiều request đến đồng thời đều là async function, nếu không khoá thì nhiều request có thể
    // cùng đọc thấy "chưa đủ maxBrowsers" trước khi request nào push xong vào this.entries, dẫn tới
    // launch thừa browser hoặc nhồi quá maxContextsPerBrowser vào 1 browser (đã xác nhận bằng test).
    this._reservationLock = Promise.resolve();
    this.watchdogTimer = setInterval(() => this._runWatchdog().catch(() => {}), watchdogIntervalMs);
    this.watchdogTimer.unref?.();
    // Khoá tuần tự riêng theo từng accountId, dùng cho acquirePersistentContext() bên dưới — Chromium
    // khoá exclusively thư mục profile trong suốt vòng đời context, nên 2 request cùng accountId phải
    // xếp hàng chờ nhau (không giống pool ở trên — pool chia sẻ PROCESS nhưng context luôn mới).
    this.persistentLocks = new Map(); // accountId(string) -> Promise (resolve khi context trước đó đã release)
  }

  async _reserveEntry() {
    const runReservation = async () => {
      // 1. Dọn dẹp các browser đã ngắt kết nối hoặc cho nghỉ hưu (retire) các browser đã đạt quota
      for (const entry of [...this.entries]) {
        if (!entry.browser.isConnected()) {
          this.entries = this.entries.filter(e => e !== entry);
          continue;
        }
        if ((entry.totalContextsCreated || 0) >= this.maxTotalContexts) {
          // Đã đạt quota: bỏ khỏi active pool ngay để nhường slot (maxBrowsers) cho browser mới!
          this.entries = this.entries.filter(e => e !== entry);
          if (entry.activeContexts === 0) {
            entry.browser.close().catch(() => {});
          } else {
            entry.retired = true;
            // Timer an toàn 60s ép đóng nếu context bị giữ quá lâu/leak
            setTimeout(() => {
              entry.browser.close().catch(() => {});
            }, 60000).unref?.();
          }
        }
      }

      let entry = this.entries.find(e => e.activeContexts < this.maxContextsPerBrowser && (e.totalContextsCreated || 0) < this.maxTotalContexts);
      if (entry) {
        entry.activeContexts += 1;
        entry.totalContextsCreated = (entry.totalContextsCreated || 0) + 1;
        return entry;
      }

      if (this.entries.length < this.maxBrowsers) {
        const freeMb = Math.round(os.freemem() / (1024 * 1024));
        if (freeMb < 150 && this.entries.length > 0) {
          console.warn(`[BrowserPool] ⚠️ RAM hệ thống thấp (${freeMb}MB free) — hoãn mở browser mới, đợi tái sử dụng slot hiện có.`);
          if (global.gc) try { global.gc(); } catch (_) {}
          return null;
        }
        const browser = await chromium.launch({
          headless: true,
          args: LOW_MEMORY_BROWSER_ARGS,
        });
        entry = { browser, activeContexts: 1, lastUsedAt: Date.now(), totalContextsCreated: 1 };
        this.entries.push(entry);
        console.log(`[BrowserPool] 🚀 Đã khởi động browser mới (tổng ${this.entries.length}/${this.maxBrowsers}). Free RAM: ${freeMb}MB.`);
        return entry;
      }

      return null;
    };

    const task = this._reservationLock.then(runReservation, runReservation);
    // Giữ chain sống dù task lỗi, để lần gọi sau không bị kẹt vào 1 promise đã reject.
    this._reservationLock = task.catch(() => {});
    return task;
  }

  /**
   * Trả về { context, release() }. release() PHẢI được gọi sau khi dùng xong (kể cả khi lỗi).
   * waitTimeoutMs > 0: nếu pool đầy quá thời gian này thì trả về null thay vì chờ vô hạn.
   */
  async acquireContext(contextOptions, { waitTimeoutMs = 15_000 } = {}) {
    const deadline = waitTimeoutMs > 0 ? Date.now() + waitTimeoutMs : 0;
    let entry = await this._reserveEntry();
    while (!entry) {
      const woke = await this._waitForSlot(deadline);
      if (!woke) return null;
      entry = await this._reserveEntry();
    }

    entry.lastUsedAt = Date.now();

    let context;
    try {
      context = await entry.browser.newContext(contextOptions);
    } catch (err) {
      entry.activeContexts = Math.max(0, entry.activeContexts - 1);
      this._wakeWaiter();
      throw err;
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        await context.close();
      } catch (e) { /* context có thể đã bị đóng do browser crash */ }
      entry.activeContexts = Math.max(0, entry.activeContexts - 1);
      entry.lastUsedAt = Date.now();

      // Nếu browser đã nghỉ hưu và hết active contexts, đóng ngay
      if (entry.retired && entry.activeContexts === 0) {
        entry.browser.close().catch(() => {});
      } else if (entry.activeContexts === 0 && (entry.totalContextsCreated || 0) >= this.maxTotalContexts) {
        this.entries = this.entries.filter(e => e !== entry);
        entry.browser.close().catch(() => {});
        console.log(`[BrowserPool] ♻️ Đã tái chế browser process sau ${entry.totalContextsCreated} contexts để tối ưu RAM.`);
      }

      this._wakeWaiter();
    };

    return { context, release };
  }

  /**
   * Context dùng 1 lần cho tác vụ scrape/hunt/buff/extract. Không có proxy → lấy context mới từ pool
   * như acquireContext() (waitTimeoutMs > 0: pool đầy quá lâu thì tự mở Chromium riêng). Có proxy →
   * vẫn mở Chromium riêng như trước, để proxy áp ở cấp browser và không dùng chung IP với pool.
   * Trả về { context, release() } — release() PHẢI được gọi trong finally.
   */
  async acquireScrapeContext(contextOptions = {}, { proxy = null, launchArgs = [], browser = null, waitTimeoutMs = 10_000 } = {}) {
    // Caller đã có sẵn 1 browser (VD route đăng bài cần cào nguồn) → mở context mới, sạch cookie trong
    // chính browser đó thay vì bật thêm 1 process Chromium; release() chỉ đóng context, không đóng browser.
    if (browser && !proxy) {
      const context = await browser.newContext(contextOptions);
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await context.close().catch(() => {});
      };
      return { context, release };
    }

    if (!proxy) {
      const acquired = await this.acquireContext(contextOptions, { waitTimeoutMs: waitTimeoutMs || 10_000 });
      if (acquired) return acquired;
      console.warn(`[BrowserPool] ⏳ Pool bận quá ${waitTimeoutMs || 10000}ms — mở Chromium riêng để cào ngay không chặn.`);
    }

    const mergedArgs = Array.from(new Set([
      ...LOW_MEMORY_BROWSER_ARGS,
      ...(launchArgs || [])
    ]));
    const ownBrowser = await chromium.launch({ headless: true, args: mergedArgs, proxy: proxy || undefined });
    let context;
    try {
      context = await ownBrowser.newContext(contextOptions);
    } catch (err) {
      await ownBrowser.close().catch(() => {});
      throw err;
    }
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await ownBrowser.close().catch(() => {});
    };
    return { context, release };
  }

  /**
   * Mở 1 browser context gắn với profile Chrome CỐ ĐỊNH trên đĩa theo accountId — khác hẳn
   * acquireContext() ở trên (context ở đó luôn "trắng" mỗi lần, không lưu gì giữa các lần gọi).
   * Dùng launchPersistentContext() để cookie/localStorage/IndexedDB/canvas fingerprint được GIỮ
   * NGUYÊN giữa các lần gọi cho cùng 1 accountId — Facebook nhìn thấy "cùng 1 thiết bị" liên tục
   * thay vì 1 thiết bị lạ mỗi lần chạy, giảm khả năng buộc đăng nhập lại dù cookie vẫn còn hạn.
   *
   * THÍ ĐIỂM: chỉ dùng cho /api/check-group-health (route phụ, không đăng bài, rủi ro thấp nếu có
   * lỗi phát sinh) — KHÔNG dùng cho route đăng bài chính cho tới khi chạy ổn định nhiều ngày.
   */
  async acquirePersistentContext(accountId, contextOptions = {}) {
    if (!accountId) throw new Error('acquirePersistentContext yêu cầu accountId để chọn đúng profile');
    const key = String(accountId);

    const prevLock = this.persistentLocks.get(key) || Promise.resolve();
    let releaseLock;
    const lockPromise = new Promise((resolve) => { releaseLock = resolve; });
    // Request tiếp theo cùng accountId phải chờ tới khi request NÀY release() (không phải chỉ chờ
    // mở xong) — vì Chromium khoá exclusively thư mục profile trong suốt vòng đời context.
    this.persistentLocks.set(key, prevLock.then(() => lockPromise, () => lockPromise));

    await prevLock.catch(() => {});

    const profileFolder = process.env.PROFILE_DIR || (process.env.PORT && process.env.PORT !== '3001' ? `browser_profiles_${process.env.PORT}` : 'browser_profiles');
    const userDataDir = path.join(__dirname, profileFolder, key);
    fs.mkdirSync(userDataDir, { recursive: true });

    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        ...contextOptions,
        // Đặt args SAU spread: caller truyền args riêng chỉ được NỐI THÊM, không ghi đè mất các flag tiết kiệm RAM.
        args: [...LOW_MEMORY_BROWSER_ARGS, ...(contextOptions?.args || [])],
      });
    } catch (err) {
      releaseLock();
      throw err;
    }

    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        await context.close();
      } catch (e) { /* profile có thể đã đóng do crash */ }
      releaseLock();
    };

    return { context, release };
  }

  /** Chờ tới khi có slot trống; trả false nếu quá deadline (0 = chờ vô hạn). */
  _waitForSlot(deadline) {
    return new Promise((resolve) => {
      let timer = null;
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(waiter);
      if (deadline) {
        timer = setTimeout(() => {
          this.waiters = this.waiters.filter(w => w !== waiter);
          resolve(false);
        }, Math.max(0, deadline - Date.now()));
      }
    });
  }

  _wakeWaiter() {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  async _runWatchdog() {
    for (const entry of [...this.entries]) {
      const isConnected = entry.browser.isConnected();
      if (!isConnected) {
        console.warn('[BrowserPool] ⚠️ Phát hiện browser process đã ngắt kết nối (crash) — loại khỏi pool.');
        this.entries = this.entries.filter(e => e !== entry);
        this._wakeWaiter();
        continue;
      }
      const idleMs = Date.now() - entry.lastUsedAt;
      const isOverLimit = (entry.totalContextsCreated || 0) >= this.maxTotalContexts;
      if (entry.activeContexts === 0 && (idleMs > this.idleTimeoutMs || isOverLimit)) {
        console.log(`[BrowserPool] 💤 Đóng browser (${Math.round(idleMs / 1000)}s idle, ${entry.totalContextsCreated || 0} contexts) để giải phóng RAM.`);
        this.entries = this.entries.filter(e => e !== entry);
        await entry.browser.close().catch(() => {});
        this._wakeWaiter();
      } else if (isOverLimit && idleMs > 120_000) {
        console.warn(`[BrowserPool] ⚠️ Buộc tái chế browser sau 120s bị giữ context (${entry.activeContexts} active, ${entry.totalContextsCreated} served).`);
        this.entries = this.entries.filter(e => e !== entry);
        await entry.browser.close().catch(() => {});
        this._wakeWaiter();
      }
    }
  }

  stats() {
    const mem = process.memoryUsage();
    return {
      browsers: this.entries.length,
      activeContexts: this.entries.reduce((sum, e) => sum + e.activeContexts, 0),
      totalContextsServed: this.entries.reduce((sum, e) => sum + (e.totalContextsCreated || 0), 0),
      waiters: this.waiters.length,
      freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      rssMb: Math.round(mem.rss / (1024 * 1024)),
    };
  }

  /** Đóng toàn bộ browser trong pool — PHẢI gọi khi worker process tắt để tránh mồ côi process Chromium. */
  async closeAll() {
    clearInterval(this.watchdogTimer);
    const entries = this.entries;
    this.entries = [];
    await Promise.all(entries.map(e => e.browser.close().catch(() => {})));
  }
}

module.exports = new BrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 3 });
