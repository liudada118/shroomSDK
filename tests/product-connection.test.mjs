import test from 'node:test';
import { beforeEach } from 'node:test';
import { activateTestLicense } from './license-fixture.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { ReadableStream } from 'node:stream/web';
import {
  connectProduct as connectWebProduct,
  connectGlove as connectWebGlove,
  connectHandPad as connectWebHandPad,
} from '../web/serial.js';
import {
  connectProduct as connectNodeProduct,
  connectGlove as connectNodeGlove,
  connectHandPad as connectNodeHandPad,
  connectSerial as connectNodeSerial,
} from '../node/serial.js';
import { decodeFrame } from '../core/frame.js';
import { ShroomError } from '../core/errors.js';

beforeEach(() => activateTestLicense());

const tick = () => new Promise((resolve) => setImmediate(resolve));
const delimiter = [0xaa, 0x55, 0x03, 0x99];
const padPayload = Uint8Array.from({ length: 1024 }, (_, index) => index % 251);
const padPacket = Uint8Array.from([...padPayload, ...delimiter]);
const glovePressure = Uint8Array.from({ length: 256 }, (_, index) => index % 251);
const gloveImu = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const glovePacket = Uint8Array.from([17, 2, ...glovePressure, ...gloveImu, ...delimiter]);
const errorIs = (code, stage = 'configure') => (error) => {
  assert.ok(error instanceof ShroomError);
  assert.equal(error.code, code);
  assert.equal(error.stage, stage);
  return true;
};

/** 替换浏览器串口授权入口，不接触真实设备。 */
function webEnvironment(t, requestPort) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort } } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
}

/** 提供可主动送字节的浏览器串口夹具。 */
class ProductWebPort extends EventTarget {
  constructor(initialBytes = null) {
    super();
    this.openCalls = [];
    this.closeCalls = 0;
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
        if (initialBytes) controller.enqueue(initialBytes);
      },
    });
  }
  async open(options) { this.openCalls.push(options); }
  async close() {
    this.closeCalls += 1;
    assert.equal(this.readable.locked, false);
  }
}

test('product adapters validate configurations before opening or requesting a port', async (t) => {
  let requests = 0;
  webEnvironment(t, async () => { requests += 1; });
  for (const connect of [connectWebProduct, connectNodeProduct]) {
    for (const options of [null, false, [], { product: 'not-a-product' }, { product: 'hand', onData: true },
      { product: 'hand', baudRate: 115200 }, { product: 'handGloveFullPacket' },
      { product: 'handGloveFullPacket', side: 'auto' }]) {
      await assert.rejects(connect(options), errorIs('INVALID_CONFIG'));
    }
  }
  for (const connect of [connectWebGlove, connectWebHandPad, connectNodeGlove, connectNodeHandPad]) {
    for (const options of [null, 1, 'COM1', []]) {
      await assert.rejects(connect(options), errorIs('INVALID_CONFIG'));
    }
  }
  assert.equal(requests, 0);
});

test('browser hand pad produces mapped data with product defaults and pre-subscribed callbacks', async (t) => {
  const port = new ProductWebPort(padPacket);
  const frames = [];
  let requests = 0;
  webEnvironment(t, async () => { requests += 1; return port; });
  const device = await connectWebHandPad({ onData: (frame) => frames.push(frame) });
  t.after(() => device.close());
  await tick();
  assert.equal(requests, 1);
  assert.deepEqual(port.openCalls, [{ baudRate: 1000000 }]);
  assert.equal(device.info.product, 'hand');
  assert.equal(device.info.rows, 32);
  assert.equal(device.info.cols, 32);
  assert.equal(device.onData, device.onFrame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].product, 'hand');
  assert.equal(frames[0].raw.length, 1024);
  assert.deepEqual(frames[0].values, decodeFrame(padPayload, { layout: 'mat32' }).values);
  assert.equal(device.getDiagnostics().status, 'streaming');
  assert.equal(device.frameLength, 1024);
  assert.equal(device.frameCount, 1);

  const subsequent = [];
  const unsubscribe = device.onData((frame) => subsequent.push(frame));
  port.controller.enqueue(padPacket);
  await tick();
  assert.equal(subsequent.length, 1);
  unsubscribe();
  await device.close();
  assert.equal(device.state, 'closed');
  assert.equal(port.closeCalls, 1);
});

test('browser product errors reach callbacks supplied at connection time', async (t) => {
  const port = new ProductWebPort();
  webEnvironment(t, async () => port);
  const errors = [];
  const device = await connectWebHandPad({ onError: (error) => errors.push(error) });
  t.after(() => device.close().catch(() => {}));
  port.controller.error(new Error('synthetic read failure'));
  await tick();
  assert.equal(errors.length, 1);
  errorIs('READ_FAILED', 'read')(errors[0]);
  assert.equal(device.state, 'error');
  assert.equal(port.closeCalls, 1);
});

test('browser glove handles split packets and delivers pressure, mapping and opaque IMU bytes', async (t) => {
  const port = new ProductWebPort();
  webEnvironment(t, async () => port);
  const frames = [];
  const device = await connectWebGlove({ side: 'left', onData: (frame) => frames.push(frame) });
  t.after(() => device.close());
  port.controller.enqueue(glovePacket.subarray(0, 105));
  await tick();
  assert.equal(frames.length, 0);
  assert.equal(device.getDiagnostics().status, 'waiting-frame');
  port.controller.enqueue(glovePacket.subarray(105));
  await tick();
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.equal(frame.product, 'handGloveFullPacket');
  assert.equal(frame.side, 'left');
  assert.equal(frame.sequence, 17);
  assert.equal(frame.packetType, 2);
  assert.deepEqual(frame.pressure, glovePressure);
  assert.deepEqual(frame.raw, glovePressure);
  assert.deepEqual(frame.imu.raw, gloveImu);
  assert.equal(frame.rows, 13);
  assert.equal(frame.cols, 15);
  assert.equal(frame.pressureMatrix.length, 195);
  assert.equal(frame.pressureMatrix[0], glovePressure[64]);
  assert.equal(frame.fingers.little.raw[0], glovePressure[30]);
  assert.equal(frame.fingers.index.pulp.raw[0], glovePressure[212]);
  assert.equal(frame.palm.raw.length, 72);
  assert.deepEqual(frame.palm.matrix.map((row) => row.length), [12, 15, 15, 15, 15]);
  assert.equal(device.frameLength, 274);
});

test('browser convenience entry fixes its product and reuses authorized ports', async (t) => {
  const port = new ProductWebPort();
  webEnvironment(t, async () => { throw new Error('must not request another port'); });
  const pad = await connectWebHandPad({ product: 'invalid', port });
  assert.equal(pad.info.product, 'hand');
  await pad.close();
  const glovePort = new ProductWebPort();
  const glove = await connectWebGlove({ port: glovePort, side: 'left' });
  assert.equal(glove.info.product, 'handGloveFullPacket');
  assert.equal(glove.info.side, 'left');
  assert.deepEqual(glovePort.openCalls, [{ baudRate: 921600 }]);
  await glove.close();
});

/** 提供可记录选口与初始数据时机的 Node 串口夹具。 */
class ProductNodePort extends EventEmitter {
  static ports = [{ path: 'PRODUCT_COM' }];
  static instances = [];
  static initialBytes = null;
  static async list() { return this.ports; }
  constructor(options) {
    super();
    this.options = options;
    this.isOpen = false;
    this.closeCalls = 0;
    ProductNodePort.instances.push(this);
  }
  open(callback) {
    queueMicrotask(() => {
      this.isOpen = true;
      callback(null);
      if (ProductNodePort.initialBytes) this.emit('data', ProductNodePort.initialBytes);
    });
  }
  close(callback) {
    this.closeCalls += 1;
    this.isOpen = false;
    this.emit('close');
    callback(null);
  }
}

test('Node products use safe port selection and preserve the generic first-port behavior', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'fake optional dependency hooks require Node 22.15+' : false,
}, async (t) => {
  const stubKey = Symbol.for('shroom.product.test.serialport');
  globalThis[stubKey] = ProductNodePort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.product.test.serialport")];')}`;
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; });

  await t.test('ambiguous and missing ports never open a guessed product', async () => {
    ProductNodePort.instances = [];
    ProductNodePort.ports = [{ path: 'FIRST' }, { path: 'SECOND' }];
    await assert.rejects(connectNodeHandPad(), errorIs('PORT_AMBIGUOUS', 'query'));
    assert.equal(ProductNodePort.instances.length, 0);
    const generic = await connectNodeSerial();
    assert.equal(generic.info.path, 'FIRST');
    await generic.close();
    ProductNodePort.ports = [];
    await assert.rejects(connectNodeHandPad(), errorIs('PORT_NOT_FOUND', 'query'));
  });

  await t.test('one port auto-selects and data callbacks are ready before open resolves', async () => {
    ProductNodePort.instances = [];
    ProductNodePort.ports = [{ path: 'ONLY_PRODUCT' }];
    ProductNodePort.initialBytes = padPacket;
    const frames = [];
    const device = await connectNodeHandPad({ onData: (frame) => frames.push(frame) });
    const port = ProductNodePort.instances[0];
    assert.equal(device.info.path, 'ONLY_PRODUCT');
    assert.equal(device.info.product, 'hand');
    assert.deepEqual(port.options, { path: 'ONLY_PRODUCT', baudRate: 1000000, autoOpen: false });
    assert.equal(frames.length, 1);
    assert.equal(frames[0].product, 'hand');
    assert.deepEqual(frames[0].values, decodeFrame(padPayload, { layout: 'mat32' }).values);
    assert.equal(device.onData, device.onFrame);
    assert.equal(device.getDiagnostics().frameCount, 1);
    await device.close();
    assert.equal(port.listenerCount('data'), 0);
    ProductNodePort.initialBytes = null;
  });

  await t.test('explicit glove port bypasses ambiguity and uses the fixed product profile', async () => {
    ProductNodePort.instances = [];
    ProductNodePort.ports = [{ path: 'FIRST' }, { path: 'SECOND' }];
    const device = await connectNodeGlove({ path: 'SECOND', side: 'right', product: 'hand' });
    assert.equal(device.info.product, 'handGloveFullPacket');
    assert.equal(device.info.side, 'right');
    assert.equal(device.info.path, 'SECOND');
    assert.equal(ProductNodePort.instances[0].options.baudRate, 921600);
    const frames = [];
    device.onData((frame) => frames.push(frame));
    ProductNodePort.instances[0].emit('data', glovePacket);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].side, 'right');
    assert.deepEqual(frames[0].pressure, glovePressure);
    assert.deepEqual(frames[0].imu.raw, gloveImu);
    assert.equal(frames[0].pressureMatrix[0], glovePressure[189]);
    await device.close();
  });
});
