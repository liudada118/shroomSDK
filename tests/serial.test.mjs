import test from 'node:test';
import { beforeEach } from 'node:test';
import { activateTestLicense } from './license-fixture.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { ReadableStream } from 'node:stream/web';
import { connectSerial as connectWeb, isSerialSupported } from '../web/serial.js';
import { connectSerial as connectNode, listPorts } from '../node/serial.js';
import { ShroomError } from '../core/errors.js';
import { serialDiagnostics } from '../core/serial-diagnostics.js';

beforeEach(() => activateTestLicense());

const tick = () => new Promise((resolve) => setImmediate(resolve));
const delimiter = [0xaa, 0x55, 0x03, 0x99];
const payload = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const packet = (...frames) => Uint8Array.from([...delimiter, ...frames.flatMap((frame) => [...frame, ...delimiter])]);
const nativeError = (message, attributes = {}) => Object.assign(new Error(message), attributes);
const errorIs = (code, stage) => (error) => {
  assert.ok(error instanceof ShroomError);
  assert.equal(error.code, code);
  assert.equal(error.stage, stage);
  assert.equal(typeof error.suggestion, 'string');
  return true;
};

function webEnvironment(t, requestPort) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
}

class FakeWebPort extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = options;
    this.openCalls = [];
    this.closeCalls = 0;
    this.cancelCalls = 0;
    this.readerCalls = 0;
    this.releaseCalls = 0;
    this.readCalls = 0;
    this.stream = new ReadableStream({
      start: (controller) => { this.controller = controller; },
      cancel: () => {
        this.cancelCalls += 1;
        if (options.cancelError) throw options.cancelError;
      },
    });
    this.readable = {
      getReader: () => {
        this.readerCalls += 1;
        if (options.readerError) throw options.readerError;
        const reader = this.stream.getReader();
        return {
          read: () => { this.readCalls += 1; return reader.read(); },
          cancel: () => reader.cancel(),
          releaseLock: () => { this.releaseCalls += 1; reader.releaseLock(); },
        };
      },
    };
  }

  async open(options) {
    this.openCalls.push(options);
    if (this.options.openError) throw this.options.openError;
  }

  async close() {
    this.closeCalls += 1;
    assert.equal(this.stream.locked, false, 'release the reader before closing the port');
    this.dispatchEvent(new Event('disconnect'));
    if (this.options.closeError) throw this.options.closeError;
  }
}

async function webDevice(t, options = {}, config = {}) {
  const port = new FakeWebPort(options);
  webEnvironment(t, async () => port);
  const device = await connectWeb(config);
  t.after(async () => { await device.close().catch(() => {}); });
  return { port, device };
}

test('browser rejects unsupported environments and validates before querying devices', async (t) => {
  let requests = 0;
  webEnvironment(t, async () => { requests += 1; });
  assert.equal(isSerialSupported(), true);
  await assert.rejects(connectWeb({ baudRate: 0 }), errorIs('INVALID_CONFIG', 'configure'));
  await assert.rejects(connectWeb({ rows: 3 }), errorIs('INVALID_CONFIG', 'configure'));
  for (const config of [{ port: {} }, { port: null }, { filters: {} }, { filters: [null] },
    { filters: [{ usbVendorId: -1 }] }, { filters: [{ usbProductId: 1 }] }]) {
    await assert.rejects(connectWeb(config), errorIs('INVALID_CONFIG', 'configure'));
  }
  assert.equal(requests, 0);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.equal(isSerialSupported(), false);
  await assert.rejects(connectWeb(), errorIs('UNSUPPORTED_ENVIRONMENT', 'query'));
});

test('browser cancellation and authorization errors preserve their causes', async (t) => {
  const cancellation = nativeError('No port selected', { name: 'NotFoundError' });
  webEnvironment(t, async () => { throw cancellation; });
  await assert.rejects(connectWeb(), (error) => {
    errorIs('USER_CANCELLED', 'query')(error);
    assert.equal(error.cause, cancellation);
    return true;
  });
  navigator.serial.requestPort = async () => { throw nativeError('access denied', { name: 'SecurityError' }); };
  await assert.rejects(connectWeb(), errorIs('PERMISSION_DENIED', 'query'));
});

test('browser forwards filters and baud rate and supports already authorized ports', async (t) => {
  const port = new FakeWebPort();
  let requested;
  webEnvironment(t, async (options) => { requested = options; return port; });
  const device = await connectWeb({ filters: [{ usbVendorId: 0x1a86 }], baudRate: 115200 });
  assert.deepEqual(requested, { filters: [{ usbVendorId: 0x1a86 }] });
  assert.deepEqual(port.openCalls, [{ baudRate: 115200 }]);
  await device.close();
  navigator.serial.requestPort = async () => { throw new Error('must not prompt'); };
  const authorized = await connectWeb({ port: new FakeWebPort() });
  await authorized.close();
});

test('browser open failures are standard errors without starting the reader', async (t) => {
  const cause = nativeError('port is in use');
  const port = new FakeWebPort({ openError: cause });
  webEnvironment(t, async () => port);
  await assert.rejects(connectWeb(), (error) => {
    errorIs('PORT_BUSY', 'connect')(error);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(port.readerCalls, 0);
});

test('browser cleans up streams from partial open failures without closing existing connections', async (t) => {
  const cause = new Error('opening failed');
  let closed = 0;
  const port = {
    readable: null,
    async open() { this.readable = {}; throw cause; },
    async close() { closed += 1; this.readable = null; },
  };
  webEnvironment(t, async () => port);
  await assert.rejects(connectWeb(), errorIs('CONNECTION_FAILED', 'connect'));
  assert.equal(closed, 1);
  port.readable = {};
  await assert.rejects(connectWeb({ port }), errorIs('CONNECTION_FAILED', 'connect'));
  assert.equal(closed, 1, 'an existing stream was not opened by this connection attempt');
});

test('browser diagnostics distinguish no bytes, incomplete frames, streaming and dropped frames', async (t) => {
  const { port, device } = await webDevice(t);
  const waiting = device.getDiagnostics();
  assert.equal(device.state, 'open');
  assert.equal(waiting.status, 'waiting-data');
  assert.match(waiting.hint, /设备/);
  port.controller.enqueue(Uint8Array.from([1, 2, 3]));
  await tick();
  assert.equal(device.bytesReceived, 3);
  assert.equal(device.getDiagnostics().status, 'waiting-frame');
  assert.match(device.getDiagnostics().hint, /波特率/);
  const frames = [];
  device.onFrame((frame) => frames.push(frame));
  const valid = packet(payload, payload, payload);
  port.controller.enqueue(valid);
  await tick();
  assert.equal(device.bytesReceived, valid.length + 3);
  assert.equal(device.frameCount, 3);
  assert.equal(device.frameLength, 9);
  assert.equal(frames[0].rows, 3);
  assert.equal(frames[0].cols, 3);
  assert.equal(device.getDiagnostics().status, 'streaming');
  assert.equal(waiting.bytesReceived, 0, 'snapshots retain counters from their creation');
  port.controller.enqueue(packet([1]));
  await tick();
  assert.ok(device.droppedCount > 0);
  assert.match(device.getDiagnostics().hint, /丢弃/);
  await device.close();
  assert.equal(device.getDiagnostics().status, 'closed');
});

test('browser close is idempotent, releases the reader and never reports intentional disconnect', async (t) => {
  const { port, device } = await webDevice(t);
  const errors = [];
  device.onError((error) => errors.push(error));
  const first = device.close();
  assert.equal(first, device.close());
  await first;
  await device.close();
  assert.equal(device.state, 'closed');
  assert.equal(port.closeCalls, 1);
  assert.equal(port.cancelCalls, 1);
  assert.equal(port.readerCalls, 1);
  assert.equal(port.releaseCalls, 1);
  assert.deepEqual(errors, []);
});

test('browser read failure stops instead of retrying and keeps diagnostic error snapshots', async (t) => {
  const { port, device } = await webDevice(t);
  const errors = [];
  device.onError((error) => errors.push(error));
  const cause = new Error('read failed');
  port.controller.error(cause);
  await tick();
  assert.equal(device.state, 'error');
  assert.equal(port.closeCalls, 1);
  assert.equal(port.readerCalls, 1);
  assert.equal(port.readCalls, 1);
  errorIs('READ_FAILED', 'read')(errors[0]);
  assert.equal(errors[0].cause, cause);
  const diagnostic = device.getDiagnostics();
  assert.equal(diagnostic.status, 'error');
  assert.equal(diagnostic.lastError.code, 'READ_FAILED');
  assert.equal(diagnostic.lastError.cause, undefined);
  diagnostic.lastError.details.changed = true;
  assert.equal(device.getDiagnostics().lastError.details.changed, undefined);
});

test('browser reader acquisition errors trigger cleanup', async (t) => {
  const savedConsole = console.error;
  console.error = () => {};
  t.after(() => { console.error = savedConsole; });
  const { port, device } = await webDevice(t, { readerError: new Error('reader unavailable') });
  await tick();
  assert.equal(port.readerCalls, 1);
  assert.equal(port.closeCalls, 1);
  assert.equal(device.getDiagnostics().lastError.code, 'READ_FAILED');
});

test('browser ended streams and unplug events report one disconnect and release resources', async (t) => {
  for (const mode of ['done', 'event']) {
    await t.test(mode, async (subtest) => {
      const { port, device } = await webDevice(subtest);
      const errors = [];
      device.onError((error) => errors.push(error));
      if (mode === 'done') port.controller.close();
      else port.dispatchEvent(new Event('disconnect'));
      await tick();
      assert.equal(device.state, 'error');
      assert.equal(port.closeCalls, 1);
      assert.equal(errors.length, 1);
      errorIs('DISCONNECTED', 'read')(errors[0]);
    });
  }
});

test('browser malformed stream bytes surface parse errors and stop reading', async (t) => {
  const { port, device } = await webDevice(t);
  const errors = [];
  device.onError((error) => errors.push(error));
  port.controller.enqueue({ length: 1 });
  await tick();
  assert.equal(device.state, 'error');
  errorIs('PARSE_FAILED', 'parse')(errors[0]);
  assert.equal(port.closeCalls, 1);
});

test('browser close failures are observable and remain idempotent', async (t) => {
  const { port, device } = await webDevice(t, { closeError: new Error('close failed') });
  const errors = [];
  device.onError((error) => errors.push(error));
  const first = device.close();
  await assert.rejects(first, errorIs('CLOSE_FAILED', 'close'));
  assert.equal(device.close(), first);
  assert.equal(port.closeCalls, 1);
  assert.equal(device.state, 'error');
  assert.equal(errors.length, 1);
});

test('browser cancellation failure still releases the lock and attempts port close', async (t) => {
  const { port, device } = await webDevice(t, { cancelError: new Error('cancel failed') });
  const errors = [];
  device.onError((error) => errors.push(error));
  await assert.rejects(device.close(), errorIs('CLOSE_FAILED', 'close'));
  assert.equal(port.closeCalls, 1);
  assert.equal(port.stream.locked, false);
  assert.equal(errors.length, 1);
});

test('browser cancel rejection never waits forever for an unresolved read', { timeout: 1000 }, async (t) => {
  let releases = 0;
  let closes = 0;
  const port = {
    async open() {},
    readable: { getReader: () => ({
      read: () => new Promise(() => {}),
      cancel: async () => { throw new Error('cancel rejected'); },
      releaseLock: () => { releases += 1; },
    }) },
    async close() { closes += 1; },
  };
  webEnvironment(t, async () => port);
  const device = await connectWeb();
  device.onError(() => {});
  await assert.rejects(device.close(), errorIs('CLOSE_FAILED', 'close'));
  assert.equal(releases, 1);
  assert.equal(closes, 1);
});

test('browser preserves live decoder configuration and stops on invalid runtime configuration', async (t) => {
  const config = { rows: 3, cols: 3 };
  const { port, device } = await webDevice(t, {}, config);
  const shapes = [];
  const errors = [];
  device.onError((error) => errors.push(error));
  device.onFrame((frame) => shapes.push([frame.rows, frame.cols]));
  port.controller.enqueue(packet(payload));
  await tick();
  config.rows = 1;
  config.cols = 9;
  port.controller.enqueue(packet(payload));
  await tick();
  assert.deepEqual(shapes, [[3, 3], [1, 9]]);
  config.fullScale = 0;
  port.controller.enqueue(packet(payload));
  await tick();
  assert.equal(device.state, 'error');
  errorIs('INVALID_CONFIG', 'configure')(errors[0]);
  assert.equal(port.closeCalls, 1);
});

test('callback errors are reported without blocking other browser subscribers', async (t) => {
  const { port, device } = await webDevice(t);
  const errors = [];
  let delivered = 0;
  device.onError((error) => errors.push(error));
  device.onFrame(() => { throw new Error('application failed'); });
  device.onFrame(() => { delivered += 1; });
  port.controller.enqueue(packet(payload));
  await tick();
  assert.equal(delivered, 1);
  assert.equal(device.state, 'open');
  errorIs('CALLBACK_FAILED', 'callback')(errors[0]);
});

test('diagnostics accept mock sources and detach plain error details', () => {
  const error = {
    name: 'ShroomError', code: 'READ_FAILED', stage: 'read', message: 'failed',
    suggestion: 'check connection', details: { attempt: 1 }, cause: new Error('private native error'),
  };
  const diagnostic = serialDiagnostics({
    source: 'mock', state: 'error', bytesReceived: 0, frameCount: 0, droppedCount: 0, frameLength: 0, lastError: error,
  });
  assert.equal(diagnostic.source, 'mock');
  assert.equal(Object.hasOwn(diagnostic.lastError, 'cause'), false);
  diagnostic.lastError.details.attempt = 2;
  assert.equal(error.details.attempt, 1);
});

class FakeNodePort extends EventEmitter {
  static scenario = {};
  static instances = [];
  static listCalls = 0;
  static async list() {
    this.listCalls += 1;
    if (this.scenario.listError) throw this.scenario.listError;
    return this.scenario.ports ?? [{ path: 'COM_FAKE', manufacturer: 'fake' }];
  }
  constructor(options) {
    super();
    this.options = options;
    this.scenario = FakeNodePort.scenario;
    this.isOpen = false;
    this.closeCalls = 0;
    FakeNodePort.instances.push(this);
    if (this.scenario.constructError) throw this.scenario.constructError;
  }
  open(callback) {
    queueMicrotask(() => {
      if (this.scenario.openError) return callback(this.scenario.openError);
      if (this.scenario.openEventError) {
        this.finishLateOpen = () => { this.isOpen = true; callback(null); };
        this.emit('error', this.scenario.openEventError);
        return;
      }
      this.isOpen = true;
      callback(null);
    });
  }
  close(callback) {
    this.closeCalls += 1;
    queueMicrotask(() => {
      if (this.scenario.closeEventError) this.emit('error', this.scenario.closeEventError);
      if (!this.scenario.closeError) this.isOpen = false;
      this.emit('close');
      callback(this.scenario.closeError ?? null);
    });
  }
}

test('Node serial lifecycle with a fake optional dependency', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'fake dependency hooks require Node 22.15+; runtime remains Node 18 compatible' : false,
}, async (t) => {
  const stubKey = Symbol.for('shroom.serial.test.fake');
  globalThis[stubKey] = FakeNodePort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.serial.test.fake")];')}`;
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; });
  const scenario = (options = {}) => {
    FakeNodePort.scenario = options;
    FakeNodePort.instances = [];
    FakeNodePort.listCalls = 0;
  };

  await t.test('query, first-port fallback and validation', async () => {
    scenario({ ports: [{ path: 'FIRST' }, { path: 'SECOND' }] });
    assert.deepEqual(await listPorts(), [{ path: 'FIRST' }, { path: 'SECOND' }]);
    const device = await connectNode();
    assert.equal(device.info.path, 'FIRST');
    assert.deepEqual(FakeNodePort.instances[0].options, { path: 'FIRST', baudRate: 1000000, autoOpen: false });
    await device.close();
    scenario();
    await assert.rejects(connectNode({ baudRate: -1 }), errorIs('INVALID_CONFIG', 'configure'));
    assert.equal(FakeNodePort.instances.length, 0);
    assert.equal(FakeNodePort.listCalls, 0);
    scenario({ ports: [] });
    await assert.rejects(connectNode(), errorIs('PORT_NOT_FOUND', 'query'));
    scenario({ listError: nativeError('permission denied', { code: 'EACCES' }) });
    await assert.rejects(listPorts(), errorIs('PERMISSION_DENIED', 'query'));
  });

  await t.test('open and constructor failures preserve native causes', async () => {
    for (const [attribute, code, stage] of [['openError', 'PORT_BUSY', 'connect'], ['constructError', 'PORT_NOT_FOUND', 'connect']]) {
      const cause = nativeError('failed', { code: code === 'PORT_BUSY' ? 'EBUSY' : 'ENOENT' });
      scenario({ [attribute]: cause });
      await assert.rejects(connectNode({ path: 'EXPLICIT' }), (error) => {
        errorIs(code, stage)(error);
        assert.equal(error.cause, cause);
        return true;
      });
      assert.equal(FakeNodePort.listCalls, 0);
    }
  });

  await t.test('frames, diagnostics and intentional close', async () => {
    scenario();
    const device = await connectNode({ path: 'EXPLICIT' });
    const port = FakeNodePort.instances[0];
    const errors = [];
    let frames = 0;
    device.onError((error) => errors.push(error));
    device.onFrame(() => { frames += 1; });
    assert.equal(device.getDiagnostics().status, 'waiting-data');
    port.emit('data', Buffer.from(packet(payload, payload, payload)));
    assert.equal(frames, 3);
    assert.equal(device.frameCount, 3);
    assert.equal(device.frameLength, 9);
    assert.equal(device.getDiagnostics().status, 'streaming');
    const first = device.close();
    assert.equal(first, device.close());
    await first;
    assert.equal(port.closeCalls, 1);
    assert.equal(device.state, 'closed');
    assert.deepEqual(errors, []);
    assert.equal(port.listenerCount('data'), 0);
    assert.equal(port.listenerCount('error'), 0);
  });

  await t.test('late successful open after an opening error releases the port', async () => {
    scenario({ openEventError: new Error('opening event error') });
    await assert.rejects(connectNode({ path: 'EXPLICIT' }), errorIs('CONNECTION_FAILED', 'connect'));
    const port = FakeNodePort.instances[0];
    assert.equal(port.isOpen, false);
    assert.equal(port.closeCalls, 0);
    port.finishLateOpen();
    await tick();
    assert.equal(port.isOpen, false);
    assert.equal(port.closeCalls, 1);
    assert.equal(port.listenerCount('data'), 0);
  });

  await t.test('live Node decoder configuration remains compatible', async () => {
    scenario();
    const config = { path: 'EXPLICIT', rows: 3, cols: 3 };
    const device = await connectNode(config);
    const port = FakeNodePort.instances[0];
    const shapes = [];
    device.onFrame((frame) => shapes.push([frame.rows, frame.cols]));
    port.emit('data', Buffer.from(packet(payload)));
    config.rows = 1;
    config.cols = 9;
    port.emit('data', Buffer.from(packet(payload)));
    assert.deepEqual(shapes, [[3, 3], [1, 9]]);
    await device.close();
  });

  await t.test('runtime read failure cleans up without retry', async () => {
    scenario();
    const device = await connectNode({ path: 'EXPLICIT' });
    const port = FakeNodePort.instances[0];
    const errors = [];
    device.onError((error) => errors.push(error));
    port.emit('error', nativeError('device removed', { code: 'ENODEV' }));
    await tick();
    errorIs('DISCONNECTED', 'read')(errors[0]);
    assert.equal(device.state, 'error');
    assert.equal(device.getDiagnostics().lastError.code, 'DISCONNECTED');
    assert.equal(port.closeCalls, 1);
    assert.equal(FakeNodePort.instances.length, 1);
    await device.close();
  });

  await t.test('unexpected close reports disconnect without closing an already closed port', async () => {
    scenario();
    const device = await connectNode({ path: 'EXPLICIT' });
    const port = FakeNodePort.instances[0];
    const errors = [];
    device.onError((error) => errors.push(error));
    port.isOpen = false;
    port.emit('close');
    await tick();
    errorIs('DISCONNECTED', 'read')(errors[0]);
    assert.equal(port.closeCalls, 0);
    assert.equal(port.listenerCount('close'), 0);
  });

  await t.test('close callback and error-event failures are observable', async () => {
    for (const attribute of ['closeError', 'closeEventError']) {
      scenario({ [attribute]: new Error('failed to close') });
      const device = await connectNode({ path: 'EXPLICIT' });
      const errors = [];
      device.onError((error) => errors.push(error));
      const first = device.close();
      await assert.rejects(first, errorIs('CLOSE_FAILED', 'close'));
      assert.equal(device.close(), first);
      assert.equal(device.state, 'error');
      assert.equal(errors.length, 1);
      assert.equal(FakeNodePort.instances[0].closeCalls, 1);
    }
  });

  await t.test('a still-open port after close failure cannot crash on later driver errors', async () => {
    scenario({ closeError: new Error('failed to close') });
    const device = await connectNode({ path: 'EXPLICIT' });
    device.onError(() => {});
    await assert.rejects(device.close(), errorIs('CLOSE_FAILED', 'close'));
    const port = FakeNodePort.instances[0];
    assert.equal(port.listenerCount('data'), 0);
    const errors = [];
    device.onError((error) => errors.push(error));
    assert.doesNotThrow(() => port.emit('error', new Error('late driver error')));
    assert.equal(errors.length, 1);
    port.isOpen = false;
    port.emit('close');
    assert.equal(port.listenerCount('error'), 0);
    assert.equal(port.listenerCount('close'), 0);
  });
});
