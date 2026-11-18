#!/usr/bin/env node
/**
 * Chuẩn bị backend + worker đi kèm bản Desktop vào src-tauri/sidecar/ (chạy trước `tauri build`).
 *
 *   npm run sidecar:prepare
 *
 * Cần: JDK 21 có jlink (JAVA_HOME), Node để chạy npm, mạng để tải dependency.
 * Phải chạy trên đúng hệ điều hành của bản cài (macOS build bản mac, Windows build bản Windows):
 * JRE, Node và ffmpeg đều là binary theo nền tảng.
 *
 * Biến môi trường tuỳ chọn:
 *   NODE_BINARY   Node runtime đóng gói vào app (mặc định: node đang chạy script này)
 *   SKIP_BACKEND=1 / SKIP_JRE=1 / SKIP_WORKER=1   bỏ qua bước tương ứng khi build lại
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'frontend/src-tauri/sidecar');
const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

// Module JDK mà Spring Boot + Hibernate + H2 + httpclient5 cần
const JRE_MODULES = [
  'java.base', 'java.compiler', 'java.desktop', 'java.instrument', 'java.management', 'java.naming',
  'java.net.http', 'java.prefs', 'java.rmi', 'java.scripting', 'java.security.jgss', 'java.security.sasl',
  'java.sql', 'java.transaction.xa', 'java.xml', 'jdk.charsets', 'jdk.crypto.cryptoki', 'jdk.crypto.ec',
  'jdk.localedata', 'jdk.management', 'jdk.net', 'jdk.unsupported', 'jdk.zipfs',
];

// Worker: chỉ mã nguồn + tài nguyên. Không bao giờ đóng gói dữ liệu của máy build
// (cookie, browser_profiles, *.json trạng thái, downloads, log...)
const WORKER_EXCLUDE_JS = /^(test|scratch)|^desktop-(bridge|runner)\.js$/;

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', shell: isWin && /\.(cmd|bat)$/.test(cmd), ...opts });
}

function javaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  if (process.platform === 'darwin') {
    try {
      return execFileSync('/usr/libexec/java_home', ['-v', '21']).toString().trim();
    } catch {}
  }
  if (isWin) {
    const commonPaths = [
      'C:\\Program Files\\Microsoft\\jdk-21.0.13.21-hotspot',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
      'C:\\Program Files\\Java\\jdk-21',
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Thiếu biến JAVA_HOME (JDK 21). Vui lòng cài đặt OpenJDK 21 hoặc cấu hình JAVA_HOME.');
}

function step(name) {
  console.log(`\n=== ${name} ===`);
}

fs.mkdirSync(out, { recursive: true });
const JAVA_HOME = javaHome();

if (!process.env.SKIP_BACKEND) {
  step('Backend jar');
  // Build trong thư mục tạm: không đụng backend/target (backend dev có thể đang chạy từ đó)
  const tmp = path.join(os.tmpdir(), 'toolzutter-backend-build');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'backend'), tmp, {
    recursive: true,
    filter: (src) => !/[\\/](target|uploads)([\\/]|$)|\.log$/.test(path.relative(root, src)),
  });
  run(path.join(tmp, isWin ? 'mvnw.cmd' : 'mvnw'), ['-q', 'package', '-DskipTests'], {
    cwd: tmp,
    env: { ...process.env, JAVA_HOME },
  });
  const jar = fs.readdirSync(path.join(tmp, 'target')).find((f) => /^saas-.*\.jar$/.test(f));
  fs.copyFileSync(path.join(tmp, 'target', jar), path.join(out, 'backend.jar'));
}

if (!process.env.SKIP_JRE) {
  step('JRE (jlink)');
  fs.rmSync(path.join(out, 'jre'), { recursive: true, force: true });
  run(path.join(JAVA_HOME, 'bin', exe('jlink')), [
    '--add-modules', JRE_MODULES.join(','),
    '--include-locales', 'en,vi',
    '--strip-debug', '--no-man-pages', '--no-header-files', '--compress', 'zip-6',
    '--output', path.join(out, 'jre'),
  ]);
  // jlink tạo vài file chỉ đọc → bundler Tauri không ghi đè được ở lần build sau
  const makeWritable = (p) => {
    fs.chmodSync(p, fs.statSync(p).mode | 0o200);
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) makeWritable(path.join(p, f));
  };
  makeWritable(path.join(out, 'jre'));
}

if (!process.env.SKIP_WORKER) {
  step('Worker');
  const src = path.join(root, 'worker');
  const dst = path.join(out, 'worker');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if ((f.endsWith('.js') && !WORKER_EXCLUDE_JS.test(f)) || f === 'package.json' || f === 'package-lock.json') {
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  }
  fs.cpSync(path.join(src, 'bgm'), path.join(dst, 'bgm'), { recursive: true });
  // Cài dependency mới vào bản copy (đúng nền tảng, không động vào node_modules của worker dev)
  run(isWin ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: dst,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
  // npm 11 chặn install script mặc định → tự tải binary ffmpeg nếu thiếu
  if (!fs.existsSync(path.join(dst, 'node_modules/ffmpeg-static', exe('ffmpeg')))) {
    run(process.execPath, ['node_modules/ffmpeg-static/install.js'], { cwd: dst });
  }
  fs.writeFileSync(path.join(dst, '.build-id'), String(Date.now()));
}

step('Node runtime');
const nodeSrc = process.env.NODE_BINARY || process.execPath;
if (process.platform === 'darwin') {
  // Node của Homebrew link tới thư viện trong /opt/homebrew → không chạy được trên máy khách
  const libs = execFileSync('otool', ['-L', nodeSrc]).toString();
  if (/\/opt\/homebrew|\/usr\/local\/(opt|Cellar)|@rpath/.test(libs)) {
    throw new Error(`${nodeSrc} phụ thuộc thư viện ngoài, không mang sang máy khác được. Dùng Node tải từ nodejs.org và đặt NODE_BINARY=<đường dẫn>`);
  }
}
fs.mkdirSync(path.join(out, 'node'), { recursive: true });
const nodeDst = path.join(out, 'node', exe('node'));
fs.copyFileSync(nodeSrc, nodeDst);
fs.chmodSync(nodeDst, 0o755);
console.log(`Node ${execFileSync(nodeDst, ['--version']).toString().trim()} ← ${nodeSrc}`);

console.log(`\nXong: ${out}`);
