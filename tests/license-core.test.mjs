import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { activateLicense, assertLicense, clearLicense, getLicenseStatus, watchLicense } from '../core/license.js';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
function offline(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({ productType: 'shroom-sdk', boundSensorTypes: ['hand'],
    sdkFeatures: ['serial', 'stream', 'recording'], expireDate: Date.now() + 86400000, ...overrides })).toString('base64');
  return Buffer.from(JSON.stringify({ payload, signature: sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64') })).toString('base64');
}
const codeIs = (code) => (error) => error.code === code && error.stage === 'license';
function onlineResult(overrides = {}) {
  const now = Date.now();
  return { valid: true, status: 'ACTIVATED', productType: 'shroom-sdk', time: now,
    expireTimestamp: now + 86400000, leaseExpiresAt: now + 60000, sensorTypes: ['hand'],
    isAllTypes: false, sdkFeatures: ['serial', 'stream', 'recording'], ...overrides };
}
function transport(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => ({ ok: true, json: async () => handler(...args) });
  t.after(() => { globalThis.fetch = original; clearLicense(); });
}

test.afterEach(clearLicense);

test('signed legacy SDK device scope covers all products and raw serial without exposing the key', async () => {
  const key = offline();
  const status = await activateLicense(key, { mode: 'offline', publicKey });
  assert.equal(status.valid, true);
  assert.equal(status.allProducts, true);
  assert.deepEqual(status.products, []);
  assertLicense({ product: 'hand', feature: 'serial' });
  assertLicense({ product: 'handGloveFullPacket', feature: 'serial' });
  assertLicense({ feature: 'serial.raw' });
  status.products.push('customer-defined-product');
  status.features.length = 0;
  assert.deepEqual(getLicenseStatus().products, []);
  assertLicense({ feature: 'serial' });
  assert.equal(JSON.stringify(getLicenseStatus()).includes(key), false);
});

test('desktop, legacy and modified offline all licenses cannot enable SDK', async () => {
  for (const productType of ['shroom-desktop', undefined]) {
    await assert.rejects(activateLicense(offline({ productType, boundSensorTypes: 'all' }), { mode: 'offline', publicKey }), codeIs('LICENSE_PRODUCT_MISMATCH'));
  }
  const envelope = JSON.parse(Buffer.from(offline(), 'base64'));
  envelope.payload = Buffer.from(JSON.stringify({ productType: 'shroom-sdk', boundSensorTypes: 'all' })).toString('base64');
  await assert.rejects(activateLicense(Buffer.from(JSON.stringify(envelope)).toString('base64'), { mode: 'offline', publicKey }), codeIs('LICENSE_INVALID'));
  assert.equal(getLicenseStatus().valid, false);
});

test('expiry and malformed feature grants fail closed while SDK model scope is ignored', async () => {
  await assert.rejects(activateLicense(offline({ expireDate: Date.now() - 1 }), { mode: 'offline', publicKey }), codeIs('LICENSE_EXPIRED'));
  for (const boundSensorTypes of [['@group:mat'], undefined, [], 'hand']) {
    await activateLicense(offline({ boundSensorTypes }), { mode: 'offline', publicKey });
    assertLicense({ product: 'handGloveFullPacket', feature: 'serial.raw' });
    assert.equal(getLicenseStatus().allProducts, true);
  }
  for (const sdkFeatures of [undefined, 'serial', null]) {
    await assert.rejects(activateLicense(offline({ sdkFeatures }), { mode: 'offline', publicKey }), codeIs('LICENSE_INVALID'));
  }
});

test('online key is opaque, server product mandatory and request carries the SDK type', async (t) => {
  let result = onlineResult();
  transport(t, (url, options) => {
    assert.equal(url, 'https://shroom.jq-industries.com/licenseCheck');
    assert.deepEqual(JSON.parse(options.body).productType, 'shroom-sdk');
    assert.equal(JSON.parse(options.body).key, 'opaque-sdk-key');
    return result;
  });
  await activateLicense('opaque-sdk-key');
  assertLicense({ product: 'hand' });
  assertLicense({ product: 'handGloveFullPacket', feature: 'serial.raw' });
  assert.equal(getLicenseStatus().allProducts, true);
  result = onlineResult({ sensorTypes: undefined, isAllTypes: false });
  await activateLicense('opaque-sdk-key');
  assertLicense({ product: 'custom-product', feature: 'serial' });
  for (const productType of [undefined, 'shroom-desktop']) {
    result = onlineResult({ productType, isAllTypes: true });
    await assert.rejects(activateLicense('opaque-sdk-key'), codeIs('LICENSE_PRODUCT_MISMATCH'));
  }
});

test('server valid=false and transport failure never become local access', async (t) => {
  transport(t, () => onlineResult({ valid: false, status: 'DEVICE_LIMIT_REACHED' }));
  await assert.rejects(activateLicense('opaque'), codeIs('LICENSE_REJECTED'));
  globalThis.fetch = async () => { throw new Error('private connection details'); };
  await assert.rejects(activateLicense('opaque'), codeIs('LICENSE_UNAVAILABLE'));
  assert.equal(getLicenseStatus().valid, false);
  assert.equal(JSON.stringify(getLicenseStatus()).includes('private connection'), false);
});

test('online computer limits ask for the stable identifier with a specific code', async (t) => {
  transport(t, () => onlineResult({ valid: false, status: 'DEVICE_ID_REQUIRED' }));
  await assert.rejects(activateLicense('opaque'), codeIs('LICENSE_DEVICE_REQUIRED'));
});

test('limited offline code still requires computer checks and bounded signed expiry and features', async (t) => {
  const expiresAt = Date.now() + 5000;
  const key = offline({ deviceLimit: 1, expireDate: expiresAt, sdkFeatures: ['serial', 'stream'] });
  await assert.rejects(activateLicense(key, { mode: 'offline', publicKey }), codeIs('LICENSE_DEVICE_REQUIRED'));
  transport(t, (url, options) => {
    assert.equal(url.endsWith('/api/license/devices/check'), true);
    assert.equal(JSON.parse(options.body).deviceId, 'a'.repeat(64));
    return onlineResult({ isAllTypes: true, sensorTypes: [], sdkFeatures: ['serial', 'serial.raw', 'stream', 'recording'] });
  });
  await activateLicense(key, { mode: 'offline', publicKey, deviceId: 'a'.repeat(64) });
  assertLicense({ product: 'hand', feature: 'serial' });
  assertLicense({ product: 'handGloveFullPacket', feature: 'serial.raw' });
  assert.throws(() => assertLicense({ feature: 'recording' }), codeIs('LICENSE_FEATURE_DENIED'));
  assert.equal(getLicenseStatus().expiresAt, expiresAt);
  assert.deepEqual(getLicenseStatus().products, []);
});

test('raw serial still requires serial capability while stream and recording remain independent', async () => {
  await activateLicense(offline({ sdkFeatures: ['stream'] }), { mode: 'offline', publicKey });
  assertLicense({ feature: 'stream' });
  for (const feature of ['serial', 'serial.raw', 'recording']) {
    assert.throws(() => assertLicense({ feature }), codeIs('LICENSE_FEATURE_DENIED'));
  }
});

test('clear cancels a pending activation so a late response cannot restore access', async (t) => {
  let resolve;
  transport(t, () => new Promise((done) => { resolve = done; }));
  const pending = activateLicense('opaque');
  await new Promise(setImmediate);
  clearLicense();
  resolve(onlineResult());
  await assert.rejects(pending, codeIs('LICENSE_REJECTED'));
  assert.equal(getLicenseStatus().valid, false);
});

test('idle sources receive one invalidation at offline expiry and on clear', async () => {
  await activateLicense(offline({ expireDate: Date.now() + 150 }), { mode: 'offline', publicKey });
  const errors = [];
  const unsubscribe = watchLicense({ product: 'hand' }, (error) => errors.push(error.code));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.deepEqual(errors, ['LICENSE_EXPIRED']);
  clearLicense();
  assert.deepEqual(errors, ['LICENSE_EXPIRED']);
  unsubscribe();
});

test('online recheck revocation invalidates access; failed refresh cannot extend a short lease', async (t) => {
  let revoked = false;
  transport(t, () => revoked ? onlineResult({ valid: false, status: 'REVOKED' }) : onlineResult({ leaseExpiresAt: Date.now() + 180 }));
  await activateLicense('opaque');
  revoked = true;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(getLicenseStatus().valid, false);
  assert.equal(getLicenseStatus().code, 'LICENSE_REJECTED');
  revoked = false;
  await activateLicense('opaque');
  globalThis.fetch = async () => { throw new Error('offline'); };
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.throws(() => assertLicense(), codeIs('LICENSE_UNAVAILABLE'));
});

test('license transport rejects remote HTTP and invalid identity before sending credentials', async () => {
  await assert.rejects(activateLicense('opaque', { serverUrl: 'http://example.com' }), codeIs('INVALID_CONFIG'));
  await assert.rejects(activateLicense('opaque', { deviceId: 'random' }), codeIs('INVALID_CONFIG'));
});

test('watch callbacks remain single-shot when clearing triggers nested unsubscribe', async () => {
  await activateLicense(offline(), { mode: 'offline', publicKey });
  let second;
  let calls = 0;
  watchLicense({}, () => second());
  second = watchLicense({}, () => { calls += 1; });
  clearLicense();
  assert.equal(calls, 0);
});

test('signed JSON null is an invalid license, with a stable error code', async () => {
  const payload = Buffer.from('null').toString('base64');
  const key = Buffer.from(JSON.stringify({ payload, signature: sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64') })).toString('base64');
  await assert.rejects(activateLicense(key, { mode: 'offline', publicKey }), codeIs('LICENSE_INVALID'));
});
