import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { activateTestLicense } from './license-fixture.mjs';
import { clearLicense } from '../src/core/license.js';
import { scanProductPortsWith } from '../src/node/serial-scan.js';
import { scanProductPorts, listPorts } from '../src/node/index.js';
import * as quick from '../src/quick-flow.js';
import { connectManagedSerial } from '../src/node/serial-reconnect.js';
import { createProductParser } from '../src/core/product.js';
import { reserveSerialPath, assertSerialPathAvailable } from '../src/node/serial-path.js';

const tail = [0xaa, 0x55, 0x03, 0x99];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const timings = { openTimeoutMs: 100, closeTimeoutMs: 100 };

/** 原始线缆字节；不借用被测解析器生成期望结果。 */
function pair(type, value = 17) {
  return Buffer.from([
    1, type, ...new Uint8Array(128).fill(value), ...tail,
    2, type, ...new Uint8Array(128).fill(value), ...new Uint8Array(16), ...tail,
  ]);
}
function samples(type, value = 17, count = 3) {
  return Buffer.concat(Array.from({ length: count }, () => pair(type, value)));
}

/** 可控驱动：全部串口只存在于内存，不查询或打开真实硬件。 */
class ProbePort extends EventEmitter {
  static plans = new Map();
  static instances = [];
  static events = [];
  static listCalls = 0;
  static set(plans) {
    this.plans = new Map(Object.entries(plans));
    this.instances = []; this.events = []; this.listCalls = 0;
  }
  static async list() {
    this.listCalls += 1;
    return [...this.plans].map(([path, plan]) => ({ path, ...(plan.metadata ?? {}) }));
  }
  constructor(options) {
    super();
    this.options = options;
    this.isOpen = false;
    this.plan = ProbePort.plans.get(options.path) ?? {};
    this.ordinal = ProbePort.instances.filter(port => port.options.path === options.path).length;
    this.closeCalls = 0;
    this.timers = [];
    ProbePort.instances.push(this);
    if (this.plan.constructorError) throw this.plan.constructorError;
  }
  open(callback) {
    ProbePort.events.push(['open', this.options.path]);
    const open = () => {
      if (this.plan.openError) { callback(this.plan.openError); return; }
      this.isOpen = true;
      callback(null);
      const chunks = typeof this.plan.chunks === 'function' ? this.plan.chunks(this) : this.plan.chunks;
      for (const chunk of chunks ?? []) {
        if (Buffer.isBuffer(chunk)) { if (this.isOpen) this.emit('data', chunk); }
        else this.timers.push(setTimeout(() => { if (this.isOpen) this.emit('data', chunk.bytes); }, chunk.after));
      }
    };
    if (this.plan.openDelay) setTimeout(open, this.plan.openDelay);
    else queueMicrotask(open);
  }
  close(callback) {
    this.closeCalls += 1;
    if (this.plan.closeNever) return;
    if (this.plan.closeError) { callback(this.plan.closeError); return; }
    const finish = () => { this.forceClose(); callback(null); };
    if (this.plan.closeDelay) this.timers.push(setTimeout(finish, this.plan.closeDelay));
    else queueMicrotask(finish);
  }
  forceClose() {
    this.isOpen = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    ProbePort.events.push(['closed', this.options.path]);
    this.emit('close');
  }
  unplug() { this.isOpen = false; this.emit('close'); }
  write() { assert.fail('协议识别不能向设备发送命令'); }
}

beforeEach(async () => { ProbePort.set({}); await activateTestLicense(); });

async function until(predicate, timeout = 800) {
  const expires = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= expires) throw new Error('模拟串口未到达期望状态');
    await delay(2);
  }
}

/** 所有公开 API 仍走实际实现，只替换可选 serialport 驱动模块。 */
function injectSerialPort(t) {
  const key = Symbol.for('shroom.scan.test.serialport');
  globalThis[key] = ProbePort;
  const url = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.scan.test.serialport")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, next) {
    return specifier === 'serialport' ? { url, shortCircuit: true } : next(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
}

test('scan identifies complete left/right streams, skips noise and busy ports, and releases before the next port', async () => {
  ProbePort.set({
    NOISE: { chunks: [Buffer.from([55, 17, 9, ...tail])] },
    BUSY: { openError: Object.assign(new Error('Port is busy'), { code: 'EBUSY' }) },
    LEFT: { metadata: { serialNumber: 'USB-LEFT' }, chunks: [samples(1)], closeDelay: 8 },
    RIGHT: { chunks: [samples(2)] },
  });
  const result = await scanProductPortsWith(ProbePort, { timeoutMs: 50 }, timings);
  assert.deepEqual(result.devices.map(({ path, side, packetType, product, baudRate }) => ({ path, side, packetType, product, baudRate })), [
    { path: 'LEFT', side: 'left', packetType: 1, product: 'handGloveSegmented', baudRate: 921600 },
    { path: 'RIGHT', side: 'right', packetType: 2, product: 'handGloveSegmented', baudRate: 921600 },
  ]);
  assert.equal(result.devices[0].serialNumber, 'USB-LEFT');
  assert.deepEqual(result.ports.map(port => [port.path, port.status]), [
    ['NOISE', 'unrecognized'], ['BUSY', 'error'], ['LEFT', 'matched'], ['RIGHT', 'matched'],
  ]);
  assert.equal(result.ports[1].error.code, 'PORT_BUSY');
  const leftClosed = ProbePort.events.findIndex(([event, path]) => event === 'closed' && path === 'LEFT');
  const rightOpened = ProbePort.events.findIndex(([event, path]) => event === 'open' && path === 'RIGHT');
  assert.ok(leftClosed >= 0 && leftClosed < rightOpened, '必须等待物理关闭，不得同时占用多个探测串口');
  for (const port of ProbePort.instances) {
    assert.equal(port.isOpen, false);
    assert.equal(port.listenerCount('data'), 0);
    assert.equal(port.options.baudRate, 921600);
  }
});

test('scan does not identify half packets, unknown types, too few pairs, or a stream mixing both hands', async () => {
  ProbePort.set({
    HALF: { chunks: [pair(1).subarray(0, 134)] },
    UNKNOWN: { chunks: [samples(99)] },
    INSUFFICIENT: { chunks: [samples(1, 17, 2)] },
    MIXED: { chunks: [samples(1), { after: 20, bytes: pair(2) }] },
  });
  const result = await scanProductPortsWith(ProbePort, { timeoutMs: 50 }, timings);
  assert.deepEqual(result.devices, []);
  assert.ok(result.ports.every(port => port.status === 'unrecognized'));
});

test('side filtering and an explicit path subset only return matching devices', async () => {
  ProbePort.set({ LEFT: { chunks: [samples(1)] }, RIGHT: { chunks: [samples(2)] }, UNTOUCHED: {} });
  const result = await scanProductPortsWith(ProbePort, { side: 'right', paths: ['LEFT', 'RIGHT'], timeoutMs: 50 }, timings);
  assert.deepEqual(result.devices.map(device => device.path), ['RIGHT']);
  assert.deepEqual(ProbePort.instances.map(port => port.options.path), ['LEFT', 'RIGHT']);
});

test('configuration and authorization failures occur before enumerating or opening hardware', async () => {
  for (const options of [null, [], { product: 'pad' }, { side: 'auto' }, { paths: [] }, { timeoutMs: 49 }, { timeoutMs: 10001 }, { signal: {} }]) {
    await assert.rejects(scanProductPortsWith(ProbePort, options, timings), { code: 'INVALID_CONFIG' });
  }
  clearLicense();
  await assert.rejects(scanProductPortsWith(ProbePort, {}, timings), { code: 'LICENSE_REQUIRED' });
  assert.equal(ProbePort.listCalls, 0);
  assert.equal(ProbePort.instances.length, 0);
});

test('abort while reading closes the active handle and does not open the next port', async () => {
  ProbePort.set({ CANCEL_READ: {}, UNTOUCHED: {} });
  const controller = new AbortController();
  const pending = scanProductPortsWith(ProbePort, { timeoutMs: 200, signal: controller.signal }, timings);
  const rejected = assert.rejects(pending, { code: 'USER_CANCELLED' });
  await until(() => ProbePort.instances[0]?.isOpen);
  controller.abort();
  await rejected;
  assert.equal(ProbePort.instances.length, 1);
  assert.equal(ProbePort.instances[0].isOpen, false);
});

test('abort during open waits for a late successful handle to close', async () => {
  ProbePort.set({ LATE_OPEN: { openDelay: 35 }, UNTOUCHED: {} });
  const controller = new AbortController();
  const pending = scanProductPortsWith(ProbePort, { timeoutMs: 50, signal: controller.signal }, timings);
  const rejected = assert.rejects(pending, { code: 'USER_CANCELLED' });
  await until(() => ProbePort.instances.length === 1);
  controller.abort();
  await rejected;
  assert.equal(ProbePort.instances[0].isOpen, false);
  assert.equal(ProbePort.instances[0].closeCalls, 1);
  assert.equal(ProbePort.instances.length, 1);
});

test('unconfirmed cleanup stops scanning and keeps the path locked until a late open is released', async () => {
  ProbePort.set({ LATE_LOCKED: { openDelay: 100 }, UNTOUCHED: {} });
  await assert.rejects(scanProductPortsWith(ProbePort, { timeoutMs: 50 }, { openTimeoutMs: 10, closeTimeoutMs: 10 }), { code: 'CLOSE_FAILED' });
  assert.equal(ProbePort.instances.length, 1);
  const retry = await scanProductPortsWith(ProbePort, { paths: ['LATE_LOCKED'], timeoutMs: 50 }, timings);
  assert.equal(retry.devices.length, 0);
  assert.equal(retry.ports[0].error.code, 'PORT_BUSY');
  assert.equal(ProbePort.instances.length, 1, 'pending close must not release the reservation early');
  await until(() => ProbePort.instances[0].closeCalls === 1 && !ProbePort.instances[0].isOpen);
  ProbePort.plans.set('LATE_LOCKED', { chunks: [samples(1)] });
  const recovered = await scanProductPortsWith(ProbePort, { paths: ['LATE_LOCKED'], timeoutMs: 50 }, timings);
  assert.equal(recovered.devices[0].side, 'left');
});

test('driver close failure cannot produce a successful match or continue to another port', async () => {
  ProbePort.set({ CLOSE_FAILED_TEST: { chunks: [samples(1)], closeError: new Error('driver refused close') }, UNTOUCHED: {} });
  try {
    await assert.rejects(scanProductPortsWith(ProbePort, { timeoutMs: 50 }, timings), { code: 'CLOSE_FAILED' });
    assert.equal(ProbePort.instances.length, 1);
  } finally { ProbePort.instances[0]?.forceClose(); }
});

test('license revocation during the probe closes hardware and prevents subsequent candidates', async () => {
  ProbePort.set({ LICENSE_STOP: {}, UNTOUCHED: {} });
  const pending = scanProductPortsWith(ProbePort, { timeoutMs: 200 }, timings);
  const rejected = assert.rejects(pending, error => error.code.startsWith('LICENSE_'));
  await until(() => ProbePort.instances[0]?.isOpen);
  clearLicense();
  await rejected;
  assert.equal(ProbePort.instances.length, 1);
  assert.equal(ProbePort.instances[0].isOpen, false);
});

test('path reservations normalize Windows names and a stale release cannot free a new owner', () => {
  const path = 'SCAN_PATH_RESERVATION';
  const alternative = process.platform === 'win32' ? path.toLowerCase() : path;
  const first = reserveSerialPath(` ${path} `);
  assert.throws(() => assertSerialPathAvailable(alternative), { code: 'PORT_BUSY' });
  first(); first();
  const second = reserveSerialPath(alternative);
  try {
    first();
    assert.throws(() => reserveSerialPath(path), { code: 'PORT_BUSY' });
  } finally { second(); }
  assert.doesNotThrow(() => assertSerialPathAvailable(path));
});

/** 使用内部短超时验证迟到句柄；驱动仍为纯内存，不缩短公开的真实硬件等待时间。 */
function connectManagedProbe(path, overrides = {}) {
  return connectManagedSerial({ SerialPort: ProbePort, path, baudRate: 921600, info: {},
    makeParser: () => createProductParser('glove', { side: 'left' }), decode: frame => frame,
    licenseRequirement: { feature: 'serial' }, policy: { enabled: true, intervalMs: 10, maxAttempts: 2 },
    onError() {}, openTimeoutMs: 15, closeTimeoutMs: 15, ...overrides });
}

test('managed initial failures free an unused path, but late opening handles retain it until physically closed', async () => {
  for (const failure of ['constructorError', 'openError']) {
    const path = `MANAGED_${failure}`;
    ProbePort.set({ [path]: { [failure]: new Error('simulated failure') } });
    await assert.rejects(connectManagedProbe(path), { code: 'CONNECTION_FAILED' });
    ProbePort.plans.set(path, { chunks: [samples(1)] });
    const result = await scanProductPortsWith(ProbePort, { paths: [path], timeoutMs: 50 }, timings);
    assert.equal(result.devices.length, 1);
  }
  const path = 'MANAGED_PENDING_OPEN';
  ProbePort.set({ [path]: { openDelay: 80 } });
  await assert.rejects(connectManagedProbe(path), { code: 'CONNECTION_FAILED' });
  const blocked = await scanProductPortsWith(ProbePort, { paths: [path], timeoutMs: 50 }, timings);
  assert.equal(blocked.ports[0].error.code, 'PORT_BUSY');
  assert.equal(ProbePort.instances.length, 1);
  await until(() => ProbePort.instances[0].closeCalls === 1 && !ProbePort.instances[0].isOpen);
  ProbePort.plans.set(path, { chunks: [samples(1)] });
  const result = await scanProductPortsWith(ProbePort, { paths: [path], timeoutMs: 50 }, timings);
  assert.equal(result.devices.length, 1);
});

test('managed close failure keeps the physical path reserved until a later close event', async () => {
  const path = 'MANAGED_PENDING_CLOSE';
  ProbePort.set({ [path]: { closeError: new Error('simulated close failure') } });
  const device = await connectManagedProbe(path);
  try {
    await assert.rejects(device.close(), { code: 'CLOSE_FAILED' });
    const blocked = await scanProductPortsWith(ProbePort, { paths: [path], timeoutMs: 50 }, timings);
    assert.equal(blocked.ports[0].error.code, 'PORT_BUSY');
    assert.equal(ProbePort.instances.length, 1);
  } finally { ProbePort.instances[0].forceClose(); }
  ProbePort.plans.set(path, { chunks: [samples(1)] });
  const result = await scanProductPortsWith(ProbePort, { paths: [path], timeoutMs: 50 }, timings);
  assert.equal(result.devices.length, 1);
});

test('public manual and automatic connection paths keep the five-function workflow', {
  skip: typeof nodeModule.registerHooks !== 'function' ? '模拟可选串口模块需要 Node 22.15+' : false,
}, async t => {
  injectSerialPort(t);
  assert.deepEqual(Object.keys(quick).sort(), ['createWS', 'downloadRecording', 'readProduct', 'startRecording', 'stopRecording']);

  await t.test('listPorts remains enumeration-only and manual readProduct bypasses scanning', async () => {
    ProbePort.set({ MANUAL: {}, OTHER: {} });
    const ports = await listPorts();
    assert.equal(ports.length, 2);
    assert.equal(ProbePort.instances.length, 0);
    const listCalls = ProbePort.listCalls;
    const device = await quick.readProduct({ product: 'glove', path: 'MANUAL', side: 'right' });
    try {
      assert.equal(ProbePort.listCalls, listCalls);
      assert.equal(ProbePort.instances.length, 1);
      assert.equal(device.info.path, 'MANUAL');
      assert.equal(device.info.side, 'right');
    } finally { await device.close(); }
  });

  await t.test('automatic selection uses packet side and never forwards probe samples', async () => {
    ProbePort.set({ NOISE: {}, AUTO: { chunks: port => [samples(1, port.ordinal === 0 ? 11 : 42)] } });
    const frames = [];
    const device = await quick.readProduct({ product: 'glove', side: 'left', scan: { timeoutMs: 50 }, onData: frame => frames.push(frame) });
    try {
      assert.equal(device.info.path, 'AUTO');
      assert.equal(device.info.side, 'left');
      assert.equal(device.info.packetType, 1);
      assert.ok(frames.length > 0, '正式打开串口后应交付新的有效帧');
      assert.ok(frames.every(frame => frame.pressure[0] === 42), '探测时读取的11不属于正式采集数据');
      assert.equal(ProbePort.instances.filter(port => port.options.path === 'AUTO').length, 2);
    } finally { await device.close(); }
  });

  await t.test('the shortest product-only entry identifies a right glove and rejects an unselected pair of hands', async () => {
    ProbePort.set({ SINGLE_RIGHT: { chunks: [samples(2)] } });
    const frames = [];
    const device = await quick.readProduct({ product: 'glove', scan: { timeoutMs: 50 }, onData: frame => frames.push(frame) });
    try {
      assert.equal(device.info.side, 'right');
      assert.ok(frames.length > 0);
      assert.ok(frames.every(frame => frame.side === 'right' && frame.packetType === 2));
    } finally { await device.close(); }
    ProbePort.set({ LEFT: { chunks: [samples(1)] }, RIGHT: { chunks: [samples(2)] } });
    await assert.rejects(quick.readProduct({ product: 'glove', scan: { timeoutMs: 50 } }), error => {
      assert.equal(error.code, 'PORT_AMBIGUOUS');
      assert.deepEqual(error.details.scan.devices.map(device => device.side), ['left', 'right']);
      return true;
    });
    assert.ok(ProbePort.instances.every(port => !port.isOpen));
  });

  await t.test('scanning never takes a managed reconnect path and can reuse it after device.close()', async () => {
    const path = 'MANAGED_RECONNECT';
    ProbePort.set({ [path]: { chunks: [samples(1)] } });
    const errors = [];
    const device = await quick.readProduct({ product: 'glove', path, side: 'left',
      reconnect: { intervalMs: 60, maxAttempts: 2 }, onError: error => errors.push(error.code) });
    try {
      ProbePort.instances[0].unplug();
      assert.equal(device.state, 'reconnecting');
      const blocked = await scanProductPorts({ paths: [path], timeoutMs: 50 });
      assert.equal(blocked.ports[0].error.code, 'PORT_BUSY');
      assert.equal(ProbePort.instances.length, 1, '扫描不能抢占等待重连期间的串口');
      await until(() => ProbePort.instances.length === 2 && device.state === 'open');
      assert.deepEqual(errors, ['DISCONNECTED']);
      const stillOwned = await scanProductPorts({ paths: [path], timeoutMs: 50 });
      assert.equal(stillOwned.ports[0].error.code, 'PORT_BUSY');
      assert.equal(ProbePort.instances.length, 2);
    } finally { await device.close(); }
    const available = await scanProductPorts({ paths: [path], timeoutMs: 50 });
    assert.equal(available.devices[0].side, 'left');
    assert.equal(ProbePort.instances.length, 3);
  });

  await t.test('explicit path with auto side still discovers the actual hand', async () => {
    ProbePort.set({ AUTO_RIGHT: { chunks: [samples(2)] }, UNTOUCHED: {} });
    const device = await quick.readProduct({ product: 'glove', path: 'AUTO_RIGHT', side: 'auto', scan: { timeoutMs: 50 } });
    try {
      assert.equal(device.info.side, 'right');
      assert.ok(ProbePort.instances.every(port => port.options.path === 'AUTO_RIGHT'));
    } finally { await device.close(); }
  });

  await t.test('multiple matches reject with candidates and zero matches reject with diagnostics', async () => {
    ProbePort.set({ LEFT_A: { chunks: [samples(1)] }, LEFT_B: { chunks: [samples(1)] } });
    await assert.rejects(quick.readProduct({ product: 'glove', side: 'left', scan: { timeoutMs: 50 } }), error => {
      assert.equal(error.code, 'PORT_AMBIGUOUS');
      assert.deepEqual(error.details.scan.devices.map(device => device.path), ['LEFT_A', 'LEFT_B']);
      return true;
    });
    assert.equal(ProbePort.instances.length, 2);
    assert.ok(ProbePort.instances.every(port => !port.isOpen));
    ProbePort.set({ UNKNOWN_ONLY: { chunks: [samples(15)] } });
    await assert.rejects(quick.readProduct({ product: 'glove', scan: { timeoutMs: 50 } }), error => {
      assert.equal(error.code, 'PORT_NOT_FOUND');
      assert.equal(error.details.scan.devices.length, 0);
      assert.equal(error.details.scan.ports[0].status, 'unrecognized');
      return true;
    });
  });

  await t.test('recognized identity is retained on reconnect and a swapped hand is rejected', async () => {
    ProbePort.set({ IDENTITY: { chunks: port => [samples(port.ordinal < 2 ? 1 : 2)] } });
    const frames = [], errors = [];
    const device = await quick.readProduct({ product: 'glove', scan: { timeoutMs: 50 },
      reconnect: { intervalMs: 10, maxAttempts: 2 }, onData: frame => frames.push(frame), onError: error => errors.push(error) });
    try {
      ProbePort.instances[1].unplug();
      await until(() => errors.some(error => error.code === 'PARSE_FAILED'));
      assert.equal(device.state, 'error');
      assert.ok(frames.every(frame => frame.side === 'left'));
      assert.equal(ProbePort.instances[2].options.path, 'IDENTITY');
      assert.equal(ProbePort.instances[2].isOpen, false);
    } finally { await device.close(); }
  });

  await t.test('the public scanner exposes detected devices without changing the quick exports', async () => {
    ProbePort.set({ API_RIGHT: { chunks: [samples(2)] } });
    const result = await scanProductPorts({ product: 'glove', timeoutMs: 50 });
    assert.equal(result.devices[0].side, 'right');
    assert.ok(ProbePort.instances.every(port => !port.isOpen));
  });
});
