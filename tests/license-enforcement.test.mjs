import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activateTestLicense } from './license-fixture.mjs';
import { clearLicense } from '../core/license.js';
import { createMockDevice, createProductMockDevice } from '../core/mock.js';
import { createFrameHub } from '../core/device.js';
import { decodeFrame } from '../core/frame.js';
import { connectSerial as connectWebSerial, connectHandPad as connectWebHandPad, connectGlove as connectWebGlove } from '../web/serial.js';
import { connectSerial as connectNodeSerial, connectHandPad as connectNodeHandPad, connectGlove as connectNodeGlove } from '../node/serial.js';
import { serveDevice } from '../node/quick-server.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
afterEach(() => clearLicense());

function browserSerial(t, requestPort) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'navigator', previous) : delete globalThis.navigator);
}

function idleWebPort() {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  return {
    readable: stream, openCalls: 0, closeCalls: 0, controller: () => controller,
    async open() { this.openCalls++; },
    async close() { this.closeCalls++; assert.equal(stream.locked, false); },
  };
}

test('unactivated licenses reject real connectors before requesting or opening hardware', async (t) => {
  clearLicense();
  let prompts = 0;
  browserSerial(t, async () => { prompts++; return idleWebPort(); });
  for (const connect of [connectWebSerial, connectWebHandPad, connectNodeSerial, connectNodeHandPad]) {
    await assert.rejects(connect(), { code: 'LICENSE_REQUIRED', stage: 'license' });
  }
  assert.equal(prompts, 0);
  await assert.rejects(connectNodeSerial({ baudRate: 0 }), { code: 'INVALID_CONFIG' });
});

test('legacy hand-only SDK licenses open hand, glove and custom serial in the browser', async (t) => {
  let prompts = 0;
  browserSerial(t, async () => { prompts++; return idleWebPort(); });
  await activateTestLicense({ boundSensorTypes: ['hand'], sdkFeatures: ['serial', 'stream', 'recording'] });
  for (const connect of [() => connectWebGlove({ side: 'left' }),
    () => connectWebSerial({ baudRate: 921600 }), () => connectWebHandPad()]) {
    const device = await connect();
    await device.close();
  }
  assert.equal(prompts, 3);
});

test('stream or recording features alone cannot open product or raw serial connectors', async (t) => {
  let prompts = 0;
  browserSerial(t, async () => { prompts++; return idleWebPort(); });
  await activateTestLicense({ sdkFeatures: ['stream', 'recording'] });
  for (const connect of [connectWebSerial, connectWebHandPad, connectNodeSerial, connectNodeHandPad]) {
    await assert.rejects(connect(), { code: 'LICENSE_FEATURE_DENIED' });
  }
  assert.equal(prompts, 0);
});

test('authorization is checked again after browser selection before opening the port', async (t) => {
  await activateTestLicense();
  const port = idleWebPort();
  let select;
  browserSerial(t, () => new Promise((resolve) => { select = resolve; }));
  const connecting = connectWebHandPad();
  clearLicense();
  select(port);
  await assert.rejects(connecting, { code: 'LICENSE_REQUIRED' });
  assert.equal(port.openCalls, 0);
});

test('license loss during browser open releases the newly opened port', async (t) => {
  await activateTestLicense();
  let finishOpen;
  const port = {
    readable: null, closeCalls: 0,
    open() { return new Promise((resolve) => { finishOpen = () => { this.readable = new ReadableStream(); resolve(); }; }); },
    async close() { this.closeCalls++; this.readable = null; },
  };
  browserSerial(t, async () => port);
  const connecting = connectWebHandPad();
  await Promise.resolve();
  clearLicense();
  finishOpen();
  await assert.rejects(connecting, { code: 'LICENSE_REQUIRED', stage: 'license' });
  assert.equal(port.closeCalls, 1);
  assert.equal(port.readable, null);
});

test('clearing a license closes an idle browser device and stops further frame delivery', async (t) => {
  await activateTestLicense();
  const port = idleWebPort();
  browserSerial(t, async () => port);
  const errors = [];
  let frames = 0;
  const device = await connectWebHandPad({ onData: () => { frames++; }, onError: (error) => errors.push(error) });
  await tick();
  clearLicense();
  await tick();
  assert.equal(device.state, 'error');
  assert.equal(port.closeCalls, 1);
  assert.equal(errors[0].code, 'LICENSE_REQUIRED');
  assert.equal(frames, 0);
  await device.close();
});

test('an expiring license closes an idle browser connection without receiving more data', { timeout: 2000 }, async (t) => {
  await activateTestLicense({ expireDate: Date.now() + 120 });
  const port = idleWebPort();
  browserSerial(t, async () => port);
  let invalidated;
  const failure = new Promise((resolve) => { invalidated = resolve; });
  const device = await connectWebHandPad({ onError: invalidated });
  let timeout;
  const error = await Promise.race([failure, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('license expiry did not close the device')), 1500);
  })]).finally(() => clearTimeout(timeout));
  assert.equal(error.code, 'LICENSE_EXPIRED');
  await device.close();
  assert.equal(port.closeCalls, 1);
  assert.equal(device.state, 'error');
});

test('legacy hand-only SDK keys cover every Node serial connector and invalidation closes each idle port', {
  skip: typeof nodeModule.registerHooks !== 'function',
}, async (t) => {
  class IdlePort extends EventEmitter {
    static instance;
    constructor() { super(); IdlePort.instance = this; this.isOpen = false; this.closeCalls = 0; }
    open(callback) { this.isOpen = true; callback(); }
    close(callback) { this.closeCalls++; this.isOpen = false; callback(); }
  }
  const stubKey = Symbol.for('shroom.license.test.serial');
  globalThis[stubKey] = IdlePort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.license.test.serial")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; });
  for (const connect of [connectNodeHandPad, connectNodeGlove, connectNodeSerial]) {
    await activateTestLicense({ boundSensorTypes: ['hand'], sdkFeatures: ['serial', 'stream', 'recording'] });
    const errors = [];
    const device = await connect({ path: 'COM_FAKE', side: connect === connectNodeGlove ? 'left' : undefined,
      onError: (error) => errors.push(error) });
    device.onError((error) => errors.push(error));
    device.info.product = 'handGloveFullPacket';
    clearLicense();
    await tick();
    assert.equal(IdlePort.instance.closeCalls, 1);
    assert.equal(device.state, 'error');
    assert.equal(errors[0].code, 'LICENSE_REQUIRED');
    await device.close();
  }
});

test('only SDK-created mocks receive license-free relay and recording access', async (t) => {
  clearLicense();
  const directory = await mkdtemp(join(tmpdir(), 'shroom-mock-license-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const spoofed = { info: { source: 'mock' }, onFrame: () => () => {} };
  await assert.rejects(serveDevice(spoofed, { port: 0, recordingsDir: directory }), { code: 'LICENSE_REQUIRED' });
  for (const device of [createMockDevice(), createProductMockDevice({ product: 'handGloveFullPacket', side: 'left' })]) {
    assert.throws(() => { device.onData = spoofed.onFrame; }, TypeError);
    assert.throws(() => { device.onFrame = spoofed.onFrame; }, TypeError);
    const server = await serveDevice(device, { port: 0, recordingsDir: directory });
    try {
      await server.startRecording({ label: '免授权模拟' });
      assert.equal((await server.stopRecording()).status, 'stopped');
    } finally { await server.close(); await device.close(); }
  }
  assert.throws(() => createProductMockDevice({ product: 'hand', port: idleWebPort() }), { code: 'INVALID_CONFIG' });
});

test('license loss interrupts new acquisition while preserving recorded data and downloads', async (t) => {
  await activateTestLicense();
  const directory = await mkdtemp(join(tmpdir(), 'shroom-recording-license-'));
  const hub = createFrameHub();
  const source = { info: { source: 'custom' }, onFrame: hub.onFrame, onError: hub.onError };
  const server = await serveDevice(source, { port: 0, recordingsDir: directory });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const recording = await server.startRecording({ label: '保留已采数据' });
  hub.emit(decodeFrame(new Uint8Array(9), { rows: 3, cols: 3 }));
  clearLicense();
  const stopped = await server.stopRecording();
  assert.equal(stopped.status, 'error');
  assert.equal(stopped.error.code, 'LICENSE_REQUIRED');
  assert.equal(stopped.frameCount, 1);
  hub.emit(decodeFrame(new Uint8Array(9), { rows: 3, cols: 3 }));
  assert.equal((await server.listRecordings())[0].frameCount, 1);
  await assert.rejects(server.startRecording({ label: '拒绝继续采集' }), { code: 'LICENSE_REQUIRED' });
  const response = await fetch(`${server.httpUrl}/recordings/${recording.id}.jsonl`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim().split('\n').length, 1);
  assert.equal((await fetch(`${server.httpUrl}/health`)).status, 200);
});

test('stream permission alone does not allow starting a recording', async (t) => {
  await activateTestLicense({ sdkFeatures: ['serial', 'stream'] });
  const directory = await mkdtemp(join(tmpdir(), 'shroom-recording-scope-'));
  const hub = createFrameHub();
  const server = await serveDevice({ onFrame: hub.onFrame }, { port: 0, recordingsDir: directory });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(server.startRecording({ label: '未购买录制' }), { code: 'LICENSE_FEATURE_DENIED' });
  assert.equal(server.getRecordingStatus(), null);
});

test('invalidation while subscribing during relay startup fails and releases its subscriptions', async (t) => {
  await activateTestLicense();
  const directory = await mkdtemp(join(tmpdir(), 'shroom-startup-license-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let detached = 0;
  const source = { onFrame() { clearLicense(); return () => { detached++; }; } };
  await assert.rejects(serveDevice(source, { port: 0, recordingsDir: directory }), { code: 'LICENSE_REQUIRED', stage: 'license' });
  assert.equal(detached, 1);
});

test('invalidation while a new recording is opening aborts it before reporting success', async (t) => {
  await activateTestLicense();
  const directory = await mkdtemp(join(tmpdir(), 'shroom-record-start-license-'));
  const hub = createFrameHub();
  const server = await serveDevice({ onFrame: hub.onFrame }, { port: 0, recordingsDir: directory });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const starting = server.startRecording({ label: '创建期间到期' });
  // Recording creation has started and yielded to the filesystem before the key is removed.
  await Promise.resolve();
  clearLicense();
  await assert.rejects(starting, { code: 'LICENSE_REQUIRED', stage: 'license' });
  const record = server.getRecordingStatus();
  assert.equal(record.status, 'error');
  assert.equal(record.error.code, 'LICENSE_REQUIRED');
  assert.equal(record.frameCount, 0);
  assert.equal((await fetch(`${server.httpUrl}/recordings/${record.id}.jsonl`)).status, 200);
});
