import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { activateTestLicense } from './license-fixture.mjs';
import { clearLicense } from '../src/core/license.js';
import { createFramer } from '../src/core/framer.js';
import { decodeFrame } from '../src/core/frame.js';
import { connectHandPad, connectSerial, listPorts } from '../src/node/serial.js';
import { connectProduct as connectWebProduct } from '../src/web/serial.js';
import { connectManagedSerial, reconnectOptions } from '../src/node/serial-reconnect.js';

const delimiter = [0xaa, 0x55, 0x03, 0x99];
const payload = Uint8Array.from({ length: 1024 }, (_, index) => index % 251);
const packet = Uint8Array.from([...payload, ...delimiter]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等待明确的连接状态，避免用固定延时推断重试是否已经开始。 */
async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待模拟串口状态超时');
    await delay(2);
  }
}

/** 可独立控制每一代打开/关闭结果，不创建任何系统串口。 */
class FakeSerial extends EventEmitter {
  static plans = [];
  static instances = [];
  static listCalls = 0;
  static async list() { this.listCalls += 1; return [{ path: 'COM_ORIGINAL' }]; }
  constructor(options) {
    super();
    this.options = options;
    this.plan = FakeSerial.plans.shift() ?? {};
    this.isOpen = false;
    this.closeCalls = 0;
    FakeSerial.instances.push(this);
    if (this.plan.constructorError) throw this.plan.constructorError;
  }
  /** 将打开回调交给测试，以复现主动取消后驱动迟到成功。 */
  open(callback) {
    this.finishOpen = (error = this.plan.openError) => {
      if (!error) this.isOpen = true;
      callback(error ?? null);
    };
    if (!this.plan.deferOpen) queueMicrotask(() => this.finishOpen());
  }
  /** 只在实际关闭时发 close，关闭失败仍保留驱动错误能力。 */
  close(callback) {
    this.closeCalls += 1;
    this.finishClose = () => {
      if (this.plan.closeError) { callback(this.plan.closeError); return; }
      this.isOpen = false;
      this.emit('close');
      callback(null);
    };
    if (!this.plan.deferClose) queueMicrotask(() => this.finishClose());
  }
  /** 模拟拔线，不假造有效数据。 */
  unplug() { this.isOpen = false; this.emit('close'); }
}

test('Node reconnection keeps stable subscriptions and owns every physical generation', {
  skip: typeof nodeModule.registerHooks !== 'function' ? 'fake dependency hooks require Node 22.15+' : false,
}, async (t) => {
  const stubKey = Symbol.for('shroom.reconnect.test.serialport');
  globalThis[stubKey] = FakeSerial;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.reconnect.test.serialport")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, next) {
    return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : next(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; clearLicense(); });
  t.beforeEach(async () => {
    FakeSerial.plans = []; FakeSerial.instances = []; FakeSerial.listCalls = 0;
    await activateTestLicense();
  });

  /** 注册统一清理，失败断言也不会遗留重连定时器。 */
  async function product(t, options = {}) {
    const errors = [], states = [];
    const device = await connectHandPad({ path: 'COM_ORIGINAL', reconnect: { intervalMs: 5, maxAttempts: 3 },
      onError: (error) => errors.push(error), onStateChange: (status) => states.push(status), ...options });
    t.after(() => device.close().catch(() => {}));
    return { device, errors, states };
  }

  /** 通过内部定时器注入验证边界，不缩短对外真实驱动的等待时间。 */
  async function managed(t, overrides = {}) {
    const errors = [];
    const device = await connectManagedSerial({ SerialPort: FakeSerial, path: 'COM_ORIGINAL', baudRate: 1000000,
      info: {}, makeParser: () => createFramer({}), decode: (bytes) => decodeFrame(bytes),
      licenseRequirement: { feature: 'serial.raw' }, policy: { enabled: true, intervalMs: 5, maxAttempts: 3 },
      onError: (error) => errors.push(error), openTimeoutMs: 40, closeTimeoutMs: 30, ...overrides });
    t.after(() => device.close().catch(() => {}));
    return { device, errors };
  }

  await t.test('query needs no license and invalid reconnect options never open hardware', async () => {
    clearLicense();
    assert.deepEqual(await listPorts(), [{ path: 'COM_ORIGINAL' }]);
    for (const reconnect of [null, 1, [], { intervalMs: null }, { maxAttempts: null },
      { intervalMs: 0 }, { maxAttempts: 0 }, { maxAttempts: 1.5 }, { unknown: true }]) {
      await assert.rejects(connectHandPad({ reconnect }), { code: 'INVALID_CONFIG' });
    }
    await assert.rejects(connectHandPad({ onStateChange: true }), { code: 'INVALID_CONFIG' });
    await assert.rejects(connectWebProduct({ product: 'pad', reconnect: true }), { code: 'INVALID_CONFIG' });
    assert.equal(FakeSerial.instances.length, 0);
    assert.equal(FakeSerial.listCalls, 1);
    assert.deepEqual(reconnectOptions({}), { enabled: false, intervalMs: 3000, maxAttempts: 3 });
  });

  await t.test('product reconnect defaults on, generic defaults off, and false opts out', async (t) => {
    const enabled = await product(t, { reconnect: undefined });
    FakeSerial.instances[0].unplug();
    assert.equal(enabled.device.state, 'reconnecting');
    await enabled.device.close();
    for (const connect of [() => connectHandPad({ path: 'COM_ORIGINAL', reconnect: false, onError() {} }),
      () => connectSerial({ path: 'COM_ORIGINAL' })]) {
      const device = await connect();
      device.onError(() => {});
      FakeSerial.instances.at(-1).unplug();
      assert.equal(device.state, 'error');
      await device.close();
    }
    assert.equal(FakeSerial.instances.length, 3);
  });

  await t.test('frames and callbacks survive reconnect without carrying an old half frame', async (t) => {
    const frames = [], subscribed = [], statuses = [];
    const { device, errors } = await product(t, { onData: (frame) => frames.push(frame) });
    device.onFrame((frame) => subscribed.push(frame));
    const offState = device.onStateChange((status) => statuses.push(status));
    const first = FakeSerial.instances[0];
    first.emit('data', packet);
    first.emit('data', payload.slice(0, 512));
    first.unplug();
    assert.equal(device.getDiagnostics().status, 'reconnecting');
    await waitFor(() => FakeSerial.instances.length === 2 && device.state === 'open');
    const second = FakeSerial.instances[1];
    assert.equal(second.options.path, 'COM_ORIGINAL');
    assert.equal(FakeSerial.listCalls, 0);
    assert.equal(device.frameCount, 1);
    assert.equal(device.getDiagnostics().status, 'waiting-data');
    assert.equal(device.getDiagnostics().reconnectAttempt, 1);
    second.emit('data', Uint8Array.from([...payload.slice(512), ...delimiter]));
    first.emit('data', packet);
    assert.equal(frames.length, 1, '旧端口和跨连接半帧不能变成新帧');
    second.emit('data', packet);
    assert.equal(frames.length, 2);
    assert.equal(subscribed.length, 2);
    assert.equal(device.frameCount, 2);
    assert.equal(device.getDiagnostics().status, 'streaming');
    assert.equal(device.getDiagnostics().reconnectAttempt, 0);
    assert.deepEqual(frames[1].raw, payload);
    assert.equal(errors[0].code, 'DISCONNECTED');
    assert.ok(statuses.some((status) => status.state === 'reconnecting'));
    offState();
    const count = statuses.length;
    await device.close();
    assert.equal(statuses.length, count);
  });

  await t.test('three failed retries end in error and initial failure never starts a loop', async (t) => {
    const unavailable = Object.assign(new Error('device missing'), { code: 'ENOENT' });
    FakeSerial.plans = [{}, ...Array.from({ length: 3 }, () => ({ openError: unavailable }))];
    const { device, errors } = await product(t);
    FakeSerial.instances[0].unplug();
    await waitFor(() => device.state === 'error');
    assert.equal(FakeSerial.instances.length, 4);
    assert.equal(device.getDiagnostics().reconnectAttempt, 3);
    assert.equal(errors.at(-1).code, 'PORT_NOT_FOUND');
    await delay(15);
    assert.equal(FakeSerial.instances.length, 4);
    await device.close();
    FakeSerial.instances = []; FakeSerial.plans = [{ openError: unavailable }];
    await assert.rejects(connectHandPad({ path: 'COM_ORIGINAL', reconnect: { intervalMs: 2 } }), { code: 'PORT_NOT_FOUND' });
    await delay(10);
    assert.equal(FakeSerial.instances.length, 1);
  });

  await t.test('successful open without a valid frame does not reset the retry budget', async (t) => {
    const { device } = await product(t);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeSerial.instances.at(-1).unplug();
      await waitFor(() => FakeSerial.instances.length === attempt + 2 && device.state === 'open');
      assert.equal(device.getDiagnostics().reconnectAttempt, attempt + 1);
    }
    FakeSerial.instances.at(-1).unplug();
    assert.equal(device.state, 'error');
    await delay(12);
    assert.equal(FakeSerial.instances.length, 4);
  });

  await t.test('manual close cancels a waiting retry and late successful open is closed', async (t) => {
    let current = await product(t, { reconnect: { intervalMs: 20 } });
    FakeSerial.instances[0].unplug();
    const close = current.device.close();
    assert.equal(close, current.device.close());
    await close;
    await delay(30);
    assert.equal(FakeSerial.instances.length, 1);
    FakeSerial.instances = []; FakeSerial.plans = [{}, { deferOpen: true }];
    current = await product(t);
    FakeSerial.instances[0].unplug();
    await waitFor(() => FakeSerial.instances.length === 2);
    const late = FakeSerial.instances[1];
    const closing = current.device.close();
    late.finishOpen();
    await closing;
    assert.equal(late.closeCalls, 1);
    assert.equal(late.isOpen, false);
    assert.equal(current.device.state, 'closed');
    assert.equal(late.listenerCount('error'), 0);
  });

  await t.test('clearing the license while waiting prevents another physical open', async (t) => {
    const { device, errors } = await product(t, { reconnect: { intervalMs: 20 } });
    FakeSerial.instances[0].unplug();
    clearLicense();
    assert.equal(device.state, 'error');
    await delay(30);
    assert.equal(FakeSerial.instances.length, 1);
    assert.equal(errors.at(-1).stage, 'license');
  });

  await t.test('state callbacks can reenter close without recursion or an extra physical close', async (t) => {
    const { device } = await product(t);
    let reentrant;
    device.onStateChange((status) => {
      if (status.state === 'closed') reentrant = device.close();
    });
    const closing = device.close();
    assert.equal(reentrant, closing);
    await closing;
    assert.equal(FakeSerial.instances[0].closeCalls, 1);
  });

  await t.test('nested close or license revocation prevents stale state delivery to later subscribers', async (t) => {
    for (const action of ['close', 'revoke']) {
      await activateTestLicense();
      const { device } = await product(t);
      const states = [];
      device.onStateChange((status) => {
        if (status.state !== 'reconnecting') return;
        if (action === 'close') void device.close();
        else clearLicense();
      });
      device.onStateChange((status) => states.push(status.state));
      FakeSerial.instances.at(-1).unplug();
      assert.deepEqual(states, [action === 'close' ? 'closed' : 'error']);
      if (action === 'revoke') assert.equal(device.getDiagnostics().lastError.code, 'LICENSE_REQUIRED');
      await device.close();
    }
  });

  await t.test('license invalidation during the initial open rejects and releases late success', async () => {
    FakeSerial.plans = [{ deferOpen: true }];
    const connecting = connectHandPad({ path: 'COM_ORIGINAL', onError() {} });
    const rejected = assert.rejects(connecting, { code: 'LICENSE_REQUIRED' });
    await waitFor(() => FakeSerial.instances.length === 1);
    clearLicense();
    await rejected;
    const late = FakeSerial.instances[0];
    late.finishOpen();
    await tick();
    assert.equal(late.isOpen, false);
    assert.equal(late.closeCalls, 1);
    assert.equal(late.listenerCount('error'), 0);
  });

  await t.test('close timeout ends retries until the original driver eventually confirms closure', async (t) => {
    FakeSerial.plans = [{ deferClose: true }];
    const { device, errors } = await managed(t);
    FakeSerial.instances[0].emit('error', new Error('read failed'));
    await waitFor(() => device.state === 'error');
    assert.equal(errors.at(-1).code, 'CLOSE_FAILED');
    assert.equal(FakeSerial.instances.length, 1);
    FakeSerial.instances[0].finishClose();
    await tick();
    assert.equal(FakeSerial.instances[0].listenerCount('error'), 0);
    await delay(12);
    assert.equal(FakeSerial.instances.length, 1);
  });

  await t.test('close failure prevents retry and still consumes late driver errors', async (t) => {
    FakeSerial.plans = [{ closeError: new Error('driver failed close') }];
    const { device, errors } = await product(t);
    FakeSerial.instances[0].emit('error', new Error('read failed'));
    await waitFor(() => device.state === 'error');
    await delay(12);
    assert.equal(FakeSerial.instances.length, 1);
    assert.equal(errors.at(-1).code, 'CLOSE_FAILED');
    assert.doesNotThrow(() => FakeSerial.instances[0].emit('error', new Error('late driver error')));
  });

  await t.test('timed-out pending opens never overlap and late success is released', async (t) => {
    FakeSerial.plans = [{}, { deferOpen: true }];
    const { device, errors } = await managed(t);
    FakeSerial.instances[0].unplug();
    await waitFor(() => device.state === 'error');
    assert.equal(FakeSerial.instances.length, 2);
    assert.equal(errors.at(-1).code, 'CLOSE_FAILED');
    const late = FakeSerial.instances[1];
    late.finishOpen();
    await tick();
    assert.equal(late.isOpen, false);
    assert.equal(late.closeCalls, 1);
    assert.equal(late.listenerCount('error'), 0);
  });

  await t.test('parser errors are terminal, while callback errors do not reconnect', async (t) => {
    const { device, errors } = await managed(t, { decode() { throw new Error('bad parser'); } });
    FakeSerial.instances[0].emit('data', Uint8Array.from([...delimiter, ...Array(9).fill(1), ...delimiter]));
    await waitFor(() => device.state === 'error');
    assert.equal(errors.at(-1).code, 'PARSE_FAILED');
    await delay(12);
    assert.equal(FakeSerial.instances.length, 1);
    await device.close();
    FakeSerial.instances = [];
    const next = await product(t, { onData() { throw new Error('application callback'); } });
    FakeSerial.instances[0].emit('data', packet);
    assert.equal(next.device.state, 'open');
    assert.equal(next.errors.at(-1).code, 'CALLBACK_FAILED');
    assert.equal(FakeSerial.instances.length, 1);
  });
});
