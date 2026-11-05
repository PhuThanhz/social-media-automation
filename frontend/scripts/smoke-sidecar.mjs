// Check the actual packaged runtimes using disposable data, without posting or browser automation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const resources = path.resolve(process.argv[2] || 'src-tauri/sidecar');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ToolZutter smoke '));
const exe = name => process.platform === 'win32' ? `${name}.exe` : name;
const children = [];
const logs = [];
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function launch(binary, args, cwd, env, label) {
  const log = path.join(data, `${label}.log`);
  logs.push(log);
  const fd = fs.openSync(log, 'w');
  const child = spawn(binary, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  child.on('error', err => { child.spawnError = err; });
  children.push(child);
}
try {
  const backendPort = await freePort();
  const workerPort = await freePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const workerUrl = `http://127.0.0.1:${workerPort}`;
  fs.cpSync(path.join(resources, 'worker'), path.join(data, 'worker'), { recursive: true });
  fs.mkdirSync(path.join(data, 'backend'));
  const shared = { PARENT_PID: String(process.pid), DESKTOP_SESSION_TOKEN: 'sidecar-smoke-session' };
  launch(path.join(resources, 'jre/bin', exe('java')), ['-Xmx512m', '-Dfile.encoding=UTF-8', '-jar', path.join(resources, 'backend.jar'), '--spring.profiles.active=desktop'], path.join(data, 'backend'), {
    ...shared, PORT: String(backendPort), APP_DATA_DIR: data, DESKTOP_PERSONAL: 'true',
    DESKTOP_WORKER_TOKEN: 'sidecar-smoke-worker', WORKER_BASE_URL: workerUrl,
    APP_JWT_SECRET: Buffer.alloc(48, 7).toString('base64'),
  }, 'backend');
  launch(path.join(resources, 'node', exe('node')), [path.join(data, 'worker/server.js')], path.join(data, 'worker'), {
    ...shared, PORT: String(workerPort), BIND_HOST: '127.0.0.1', BACKEND_URL: backendUrl,
    WORKER_PUBLIC_URL: workerUrl, BACKEND_TOKEN: 'sidecar-smoke-worker',
    PLAYWRIGHT_BROWSERS_PATH: path.join(data, 'ms-playwright'),
  }, 'worker');
  const deadline = Date.now() + 90000;
  while (true) {
    for (const child of children) {
      if (child.spawnError) throw child.spawnError;
      assert.equal(child.exitCode, null, `Runtime exited: ${child.exitCode}`);
    }
    const statuses = await Promise.all([`${backendUrl}/actuator/health`, `${workerUrl}/api/health`].map(async url => {
      try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
    }));
    if (statuses.every(Boolean)) break;
    assert.ok(Date.now() < deadline, 'Packaged backend/worker startup timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const setup = await fetch(`${backendUrl}/api/desktop/setup-status`, { headers: { 'X-Session-Token': shared.DESKTOP_SESSION_TOKEN } });
  assert.equal(setup.status, 200);
  const body = await setup.json();
  assert.equal(body.needsSetup, true);
  assert.equal(body.plan.personal, true);
  assert.equal((await fetch(`${backendUrl}/api/desktop/setup-status`)).status, 401);
  const unauthorizedWorker = await fetch(`${workerUrl}/api/buff-settings`);
  assert.equal(unauthorizedWorker.status, 401);
  console.log('PASS: packaged Java, backend, Node and worker start; personal setup is ready; session checks remain enforced.');
} catch (err) {
  for (const file of logs) if (fs.existsSync(file)) console.error(fs.readFileSync(file, 'utf8').slice(-16000));
  throw err;
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    const exited = once(child, 'exit');
    child.kill();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timeout);
  }
}
