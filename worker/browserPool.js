const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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
  constructor({ maxBrowsers = 2, maxContextsPerBrowser = 3, idleTimeoutMs = 5 * 60_000, watchdogIntervalMs = 60_000 } = {}) {
    this.maxBrowsers = maxBrowsers;
    this.maxContextsPerBrowser = maxContextsPerBrowser;
    this.idleTimeoutMs = idleTimeoutMs;
    this.entries = []; // { browser, activeContexts, lastUsedAt }
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
      let entry = this.entries.find(e => e.activeContexts < this.maxContextsPerBrowser);
      if (entry) {
        entry.activeContexts += 1;
        return entry;
      }

      if (this.entries.length < this.maxBrowsers) {
        const browser = await chromium.launch({
          headless: true,
          args: [
            '--disk-cache-size=33554432',
            '--media-cache-size=33554432',
            '--disable-dev-shm-usage',
          ],
        });
        entry = { browser, activeContexts: 1, lastUsedAt: Date.now() };
        this.entries.push(entry);
        console.log(`[BrowserPool] 🚀 Đã khởi động browser mới (tổng ${this.entries.length}/${this.maxBrowsers}).`);
        return entry;
      }

      return null;
    };

    const task = this._reservationLock.then(runReservation, runReservation);
    // Giữ chain sống dù task lỗi, để lần gọi sau không bị kẹt vào 1 promise đã reject.
    this._reservationLock = task.catch(() => {});
    return task;
  }

  /** Trả về { context, release() }. release() PHẢI được gọi sau khi dùng xong (kể cả khi lỗi). */
  async acquireContext(contextOptions) {
    let entry = await this._reserveEntry();
    while (!entry) {
      await new Promise(resolve => this.waiters.push(resolve));
      entry = await this._reserveEntry();
    }

    entry.lastUsedAt = Date.now();

    let context;
    try {
      context = await entry.browser.newContext(contextOptions);
    } catch (err) {
      entry.activeContexts -= 1;
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
      this._wakeWaiter();
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
        args: [
          '--disk-cache-size=33554432',
          '--media-cache-size=33554432',
          '--disable-dev-shm-usage',
          ...(contextOptions?.args || []),
        ],
        ...contextOptions,
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
      if (entry.activeContexts === 0 && idleMs > this.idleTimeoutMs) {
        console.log(`[BrowserPool] 💤 Đóng browser rảnh quá ${Math.round(idleMs / 1000)}s để giải phóng RAM.`);
        this.entries = this.entries.filter(e => e !== entry);
        await entry.browser.close().catch(() => {});
      }
    }
  }

  stats() {
    return {
      browsers: this.entries.length,
      activeContexts: this.entries.reduce((sum, e) => sum + e.activeContexts, 0),
      waiters: this.waiters.length,
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
