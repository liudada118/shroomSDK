import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as nodeModule from 'node:module';
import { activateTestLicense } from './license-fixture.mjs';
import { scanProductPortsWith } from '../src/node/serial-scan.js';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from '../src/quick-flow.js';

const tail = [0xaa, 0x55, 0x03, 0x99];
const timings = { openTimeoutMs: 100, closeTimeoutMs: 100 };
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

/** Synthetic pressure and opaque IMU wire data; no real devices are opened by this suite. */
function sample(type = 3, offset = 0) {
  const pressure = Uint8Array.from({ length: 256 }, (_, i) => (i + offset) & 255);
  const imu = Uint8Array.of(0, 0, 192, 127, 0, 0, 128, 255, 5, 4, 3, 2, 255, 254, 1, 0);
  const first = Uint8Array.from([1, type, ...pressure.slice(0, 128), ...tail]);
  const second = Uint8Array.from([2, type, ...pressure.slice(128), ...imu, ...tail]);
  return { pressure, imu, first, second, wire: Buffer.from([...first, ...second]) };
}

/** Provide the three complete frames needed to identify a stable side during a probe. */
function samples(type, offset = 0) {
  return Buffer.concat(Array.from({ length: 3 }, () => sample(type, offset).wire));
}

/** An in-memory serial driver, with a separate plan for probing and subsequent real connection. */
class FootPort extends EventEmitter {
  static plans = new Map();
  static instances = [];
  static listCalls = 0;

  static set(plans) {
    this.plans = new Map(Object.entries(plans));
    this.instances = [];
    this.listCalls = 0;
  }

  static async list() {
    this.listCalls += 1;
    return [...this.plans.keys()].map(path => ({ path }));
  }

  constructor(options) {
    super();
    this.options = options;
    this.plan = FootPort.plans.get(options.path) ?? {};
    this.ordinal = FootPort.instances.filter(port => port.options.path === options.path).length;
    this.isOpen = false;
    FootPort.instances.push(this);
  }

  open(callback) {
    queueMicrotask(() => {
      this.isOpen = true;
      callback(null);
      const chunks = typeof this.plan.chunks === 'function' ? this.plan.chunks(this) : this.plan.chunks;
      for (const chunk of chunks ?? []) if (this.isOpen) this.emit('data', chunk);
    });
  }

  close(callback) {
    this.isOpen = false;
    this.emit('close');
    callback(null);
  }

  unplug() {
    this.isOpen = false;
    this.emit('close');
  }

  write() { assert.fail('Discovery must not write commands to a sensor'); }
}

/** Keep the SDK's public entry points and lifecycle intact, replacing only the optional driver. */
function injectSerialPort(t) {
  const key = Symbol.for('shroom.tactile-foot.test.serialport');
  globalThis[key] = FootPort;
  const url = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.tactile-foot.test.serialport")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, next) {
    return specifier === 'serialport' ? { url, shortCircuit: true } : next(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
}

/** Wait for a lifecycle transition, rejecting instead of leaving a stalled test running. */
async function until(predicate, timeout = 1500) {
  const expires = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= expires) throw new Error('Tactile-foot fake serial transition timed out');
    await delay(2);
  }
}

/** Register before sending bytes so the actual WS transport cannot race the test subscription. */
function oneFrame(stream) {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Tactile-foot WS frame timed out')); }, 3000);
    const off = stream.onData(frame => { clearTimeout(timer); off(); resolveFrame(frame); });
  });
}

beforeEach(async () => { FootPort.set({}); await activateTestLicense(); });

test('foot discovery distinguishes foot types from glove types and releases all probed ports', async () => {
  FootPort.set({
    GLOVE_LEFT: { chunks: [samples(1)] },
    GLOVE_RIGHT: { chunks: [samples(2)] },
    LEFT: { chunks: [samples(3)] },
    RIGHT: { chunks: [samples(4)] },
    MIXED: { chunks: [samples(3), samples(4)] },
    HALF: { chunks: [sample(3).first] },
  });
  const result = await scanProductPortsWith(FootPort, { product: 'foot', timeoutMs: 50 }, timings);
  assert.deepEqual(result.devices.map(({ path, product, side, packetType, baudRate }) => ({ path, product, side, packetType, baudRate })), [
    { path: 'LEFT', product: 'footVideo', side: 'left', packetType: 3, baudRate: 921600 },
    { path: 'RIGHT', product: 'footVideo', side: 'right', packetType: 4, baudRate: 921600 },
  ]);
  assert.deepEqual(result.ports.map(port => [port.path, port.status]), [
    ['GLOVE_LEFT', 'unrecognized'], ['GLOVE_RIGHT', 'unrecognized'], ['LEFT', 'matched'],
    ['RIGHT', 'matched'], ['MIXED', 'unrecognized'], ['HALF', 'unrecognized'],
  ]);
  for (const port of FootPort.instances) {
    assert.equal(port.isOpen, false);
    assert.equal(port.listenerCount('data'), 0);
    assert.equal(port.options.baudRate, 921600);
  }
});

test('foot discovery can select one side without changing either side identification or raw values', async () => {
  FootPort.set({ LEFT: { chunks: [samples(3, 1)] }, RIGHT: { chunks: [samples(4, 255)] } });
  const result = await scanProductPortsWith(FootPort, { product: 'footVideo', side: 'right', timeoutMs: 50 }, timings);
  assert.deepEqual(result.devices.map(device => [device.path, device.side, device.packetType]), [['RIGHT', 'right', 4]]);
  assert.deepEqual(result.ports.map(port => port.status), ['matched', 'matched']);
});

test('Node foot connection keeps manual path+side direct and discards automatic probe samples', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'Serial driver injection requires Node22.15+' : false,
}, async t => {
  injectSerialPort(t);
  FootPort.set({ MANUAL: { chunks: [sample(4, 19).wire] } });
  const manualFrames = [];
  const manual = await readProduct({ product: 'foot', path: 'MANUAL', side: 'right', onData: frame => manualFrames.push(frame) });
  try {
    assert.equal(FootPort.listCalls, 0);
    assert.equal(FootPort.instances.length, 1);
    assert.equal(manualFrames.length, 1);
    assert.equal(manualFrames[0].side, 'right');
    assert.deepEqual(manualFrames[0].pressure, sample(4, 19).pressure);
  } finally { await manual.close(); }

  FootPort.set({ AUTO: { chunks: port => [port.ordinal === 0 ? samples(3, 9) : sample(3, 41).wire] } });
  const automaticFrames = [];
  const automatic = await readProduct({ product: 'foot', path: 'AUTO', scan: { timeoutMs: 50 }, onData: frame => automaticFrames.push(frame) });
  try {
    assert.deepEqual(FootPort.instances.map(port => port.options.path), ['AUTO', 'AUTO']);
    assert.equal(FootPort.instances[0].isOpen, false);
    assert.equal(automatic.info.product, 'footVideo');
    assert.equal(automatic.info.side, 'left');
    assert.equal(automatic.info.packetType, 3);
    assert.equal(automaticFrames.length, 1);
    assert.deepEqual(automaticFrames[0].pressure, sample(3, 41).pressure);
    assert.deepEqual(automaticFrames[0].rawPackets[0], sample(3, 41).first);
  } finally { await automatic.close(); }
});

test('automatic foot identity survives reconnect and prevents delivery from a swapped foot', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'Serial driver injection requires Node22.15+' : false,
}, async t => {
  injectSerialPort(t);
  FootPort.set({ IDENTITY: { chunks: port => [port.ordinal < 2 ? samples(3) : samples(4)] } });
  const frames = [], errors = [];
  const device = await readProduct({
    product: 'foot', path: 'IDENTITY', scan: { timeoutMs: 50 }, reconnect: { intervalMs: 1, maxAttempts: 2 },
    onData: frame => frames.push(frame), onError: error => errors.push(error),
  });
  try {
    FootPort.instances[1].unplug();
    await until(() => device.state === 'error');
    assert.deepEqual(new Set(frames.map(frame => frame.side)), new Set(['left']));
    assert.ok(errors.some(error => error.code === 'PARSE_FAILED'));
    assert.equal(FootPort.instances.length, 3);
    assert.equal(FootPort.instances[2].isOpen, false);
  } finally { await device.close(); }
});

test('both feet retain exact wire bytes through Node five-step calls, WS, SQLite and HTTP exports', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'Serial driver injection requires Node22.15+' : false,
}, async t => {
  injectSerialPort(t);
  for (const [type, side] of [[3, 'left'], [4, 'right']]) {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, 'shroom-tactile-foot-'));
    FootPort.set({ TACTILE_FOOT: {} });
    let device, server, stream;
    try {
      const errors = [];
      device = await readProduct({ product: 'foot', path: 'TACTILE_FOOT', side, onError: error => errors.push(error) });
      server = await createWS(device, { port: 0, recordingsDir: directory });
      stream = await readProduct({ url: server.url, onError: error => errors.push(error) });
      const started = await startRecording(server, { label: `原始足底-${side}` });
      assert.equal(started.product, 'footVideo');
      assert.equal(started.side, side);
      const fixture = sample(type, 7);
      const pending = oneFrame(stream);
      const port = FootPort.instances.at(-1);
      for (let i = 0; i < fixture.wire.length; i += 13) port.emit('data', fixture.wire.subarray(i, i + 13));
      const frame = await pending;
      assert.equal(frame.product, 'footVideo');
      assert.equal(frame.side, side);
      assert.equal(frame.packetType, type);
      assert.deepEqual(frame.raw, fixture.pressure);
      assert.deepEqual(frame.pressureMatrix, fixture.pressure);
      assert.deepEqual(frame.imu.raw, fixture.imu);
      assert.deepEqual(frame.rawPackets, [fixture.first, fixture.second]);
      const stopped = await stopRecording(server);
      assert.equal(stopped.id, started.id);
      assert.equal(stopped.frameCount, 1);
      const exportedResponse = await fetch(downloadRecording(server, { format: 'jsonl' }));
      assert.equal(exportedResponse.status, 200);
      const exported = JSON.parse((await exportedResponse.text()).trim());
      assert.deepEqual(exported.frame.raw, Array.from(fixture.pressure));
      assert.deepEqual(exported.frame.imu.raw, Array.from(fixture.imu));
      assert.deepEqual(exported.frame.rawPackets, [Array.from(fixture.first), Array.from(fixture.second)]);
      assert.deepEqual(Buffer.from(exported.frame.rawPackets.flat()), fixture.wire);
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(join(directory, 'recordings.sqlite'), { readonly: true });
      try {
        const rows = db.prepare('SELECT row_json FROM frames WHERE session_id = ? ORDER BY frame_index').all(started.id);
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0].row_json).frame, exported.frame);
      } finally { db.close(); }
      const csv = await fetch(downloadRecording(server)).then(response => response.text());
      assert.ok(csv.includes('""rawPackets""'), 'CSV full-frame field retains the original packets');
      assert.deepEqual(errors, []);
    } finally {
      await stream?.close();
      await server?.close();
      await device?.close();
      assert.equal(dirname(resolve(directory)), temporaryRoot);
      await rm(directory, { recursive: true, force: true });
    }
  }
});
