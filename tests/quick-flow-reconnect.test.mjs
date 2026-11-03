import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { activateTestLicense } from './license-fixture.mjs';
import { listPorts } from '../src/node/index.js';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from '../src/quick-flow.js';

/** 模拟物理串口，真实五步函数、WS、SQLite 和 HTTP 导出仍执行生产实现。 */
class RecoveringPort extends EventEmitter {
  static instances = [];
  /** 扫描只返回可选端口，不打开任何设备。 */
  static async list() { return [{ path: 'COM_RECOVER', serialNumber: 'test-only' }]; }
  /** 保存配置，便于核对重连仍使用同一路径。 */
  constructor(options) { super(); this.options = options; this.isOpen = false; RecoveringPort.instances.push(this); }
  /** 模拟异步成功打开。 */
  open(callback) { queueMicrotask(() => { this.isOpen = true; callback(null); }); }
  /** 模拟确认关闭后再交付回调。 */
  close(callback) { this.isOpen = false; this.emit('close'); queueMicrotask(() => callback(null)); }
  /** 主动模拟拔线，无实际硬件副作用。 */
  unplug() { this.isOpen = false; this.emit('close'); }
  /** 发送独立手垫协议帧，每次采用不同 ADC 常量便于核对旧帧未混入。 */
  frame(value) { this.emit('data', Buffer.from([...new Uint8Array(1024).fill(value), 0xaa, 0x55, 0x03, 0x99])); }
}

/** 等待异步状态完成，有明确超时，不猜写盘或网络耗时。 */
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('状态未在期限内完成');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('five functions retain WS subscriptions after serial recovery and split interrupted recordings', {
  skip: typeof nodeModule.registerHooks !== 'function' ? '模拟串口依赖注入需要 Node 22.15+' : false,
}, async (t) => {
  await activateTestLicense();
  RecoveringPort.instances = [];
  const stubKey = Symbol.for('shroom.quick.reconnect.serial');
  globalThis[stubKey] = RecoveringPort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.quick.reconnect.serial")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, next) {
    return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : next(specifier, context);
  } });
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'shroom-flow-reconnect-'));
  let device;
  let server;
  let stream;
  t.after(async () => {
    try { await stream?.close(); await server?.close(); await device?.close(); }
    finally {
      hooks.deregister(); delete globalThis[stubKey];
      assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const ports = await listPorts();
  assert.equal(RecoveringPort.instances.length, 0);
  const directFrames = [];
  const webFrames = [];
  const errors = [];
  const states = [];
  device = await readProduct({ product: 'pad', path: ports[0].path,
    reconnect: { intervalMs: 200, maxAttempts: 3 },
    onData: frame => directFrames.push(frame.raw[0]), onError: error => errors.push(error),
    onStateChange: state => states.push(state.state),
  });
  const originalHandle = device;
  server = await createWS(device, { port: 0, recordingsDir: directory });
  stream = await readProduct({ url: server.url, onData: frame => webFrames.push(frame.raw[0]), onError: () => {} });
  const firstRecord = await startRecording(server, { label: '拔线前' });
  const firstPort = RecoveringPort.instances[0];
  firstPort.frame(11);
  await until(() => webFrames.length === 1);
  firstPort.unplug();
  assert.equal(device.state, 'reconnecting');
  await assert.rejects(startRecording(server, { label: '不能在重连中开始' }), { code: 'DISCONNECTED' });
  await until(() => server.getRecordingStatus()?.status === 'error');
  await until(() => RecoveringPort.instances.length === 2 && device.state === 'open');
  assert.equal(device, originalHandle);
  assert.equal(device.getDiagnostics().status, 'waiting-data', '旧连接帧数不能代表新连接已取数');
  assert.equal(RecoveringPort.instances[1].options.path, 'COM_RECOVER');
  firstPort.frame(99);
  RecoveringPort.instances[1].frame(22);
  await until(() => webFrames.length === 2);
  assert.deepEqual(directFrames, [11, 22]);
  assert.deepEqual(webFrames, [11, 22]);
  assert.equal(server.getRecordingStatus().status, 'error', '恢复实时数据不能自动续录旧会话');
  const interrupted = await stopRecording(server);
  assert.equal(interrupted.id, firstRecord.id);
  assert.equal(interrupted.status, 'error');
  assert.equal(interrupted.frameCount, 1);
  const firstResponse = await fetch(downloadRecording(server, { format: 'jsonl' }));
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.text()).trim().split('\n').length, 1);

  const secondRecord = await startRecording(server, { label: '恢复后新会话' });
  RecoveringPort.instances[1].frame(33);
  await until(() => webFrames.length === 3);
  const completed = await stopRecording(server);
  assert.notEqual(secondRecord.id, firstRecord.id);
  assert.equal(completed.status, 'stopped');
  assert.equal(completed.frameCount, 1);
  assert.equal((await fetch(downloadRecording(server, { format: 'csv' }))).status, 200);
  assert.ok(errors.some(error => error.code === 'DISCONNECTED'));
  assert.ok(states.includes('reconnecting'));
  RecoveringPort.instances[1].unplug();
  await server.close();
  assert.equal(device.state, 'closed');
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(RecoveringPort.instances.length, 2, '服务关闭取消后台重连');
});
