const test = require('node:test');
const assert = require('node:assert');
const { getDeviceForUid, DEVICE_PROFILES } = require('../device-fingerprints');

test('device-fingerprints - deterministic profile selection by UID', (t) => {
  const uid = '100023403136194';
  const profile1 = getDeviceForUid(uid);
  const profile2 = getDeviceForUid(uid);

  assert.strictEqual(profile1.name, profile2.name, 'Same UID must always produce the same device profile');
  assert.ok(profile1.userAgent.length > 20);
  assert.ok(profile1.viewport.width >= 1024);
});

test('device-fingerprints - covers multiple realistic device configurations', (t) => {
  assert.ok(DEVICE_PROFILES.length >= 4);
  const uids = ['10001', '10002', '10003', '10004', '10005', '10006'];
  const profileNames = new Set(uids.map(u => getDeviceForUid(u).name));
  assert.ok(profileNames.size > 1, 'Different UIDs should spread across multiple profiles');
});

