import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync(new URL('../src/desktop/zoom.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const calls = [];
const storage = new Map([['desktop_interface_zoom', '1.3']]);
let handler;
const exports = {};
vm.runInNewContext(code, {
  exports, console,
  require: () => ({ invoke: async (name, args) => { calls.push([name, args.factor]); } }),
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  window: {
    addEventListener: (name, callback) => { assert.equal(name, 'keydown'); handler = callback; },
    removeEventListener: (name, callback) => { assert.equal(callback, handler); handler = undefined; },
  },
});
const key = (value, patch = {}) => ({ key: value, code: '', ctrlKey: true, metaKey: false, altKey: false, ...patch });
assert.equal(exports.zoomForKey(key('+'), 1), 1.1);
assert.equal(exports.zoomForKey(key('='), 1), 1.1);
assert.equal(exports.zoomForKey(key('-'), 1), 0.9);
assert.equal(exports.zoomForKey(key('0'), 1.8), 1);
assert.equal(exports.zoomForKey(key('+'), 2), 2);
assert.equal(exports.zoomForKey(key('-'), 0.5), 0.5);
assert.equal(exports.zoomForKey(key('+', { ctrlKey: false, metaKey: true }), 1), 1.1);
assert.equal(exports.zoomForKey(key('+', { ctrlKey: false }), 1), null);
assert.equal(exports.zoomForKey(key('+', { altKey: true }), 1), null);
assert.equal(exports.zoomForKey(key('s'), 1), null);
assert.equal(exports.zoomForKey(key('Add', { code: 'NumpadAdd' }), 1), 1.1);
const stop = exports.installDesktopZoom();
let prevented = 0;
for (const value of ['+', '+', '-', '0']) {
  handler({ ...key(value), preventDefault() { prevented++; }, stopPropagation() {} });
}
await new Promise(setImmediate);
assert.deepEqual(calls.map(([, factor]) => factor), [1.3, 1.4, 1.5, 1.4, 1]);
assert.ok(calls.every(([name]) => name === 'set_interface_zoom'));
assert.equal(prevented, 4);
assert.equal(storage.get('desktop_interface_zoom'), '1');
stop();
assert.equal(handler, undefined);
console.log('PASS: zoom shortcuts, limits, Mac modifiers, native call order, restore and persistence.');
