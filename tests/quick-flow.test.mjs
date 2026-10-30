import test from 'node:test';
import { beforeEach } from 'node:test';
import { activateTestLicense } from './license-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Shroom as NodeShroom } from '../node/index.js';
import { Shroom as BrowserShroom } from '../web/index.js';
import { createFrameHub } from '../core/device.js';
import { decodeGlovePacket } from '../core/glove.js';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import * as nodeModule from 'node:module';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from '../quick-flow.js';

beforeEach(() => activateTestLicense());

/** A manually clocked glove source makes network and recording assertions deterministic. */
function quickSource() {
  const hub = createFrameHub();
  return { info: { source: 'mock', product: 'handGloveFullPacket', side: 'left' },
    onFrame: hub.onFrame, onData: hub.onFrame, onError: hub.onError,
    emit(index) {
      const packet = Uint8Array.from({ length: 274 }, (_, i) => (i + index) & 255);
      hub.emit(decodeGlovePacket(packet, { side: 'left' }));
    },
  };
}

/** Wait for a fixed number of received frames without relying on wall-clock sleeps. */
function framesFrom(client, count) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('frame timeout')); }, 3000);
    const unsubscribe = client.onData((frame) => {
      frames.push(frame);
      if (frames.length === count) { clearTimeout(timer); unsubscribe(); resolve(frames); }
    });
  });
}

test('quick page groups capture start and stop together and keeps downloads separate', async () => {
  const html = await readFile(new URL('../web/quick-start.html', import.meta.url), 'utf8');
  const capture = html.match(/<section[^>]*aria-labelledby="capture-title"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  const downloads = html.match(/<section[^>]*aria-labelledby="downloads-title"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(capture);
  assert.ok(downloads);
  assert.match(capture, /id="start"/);
  assert.match(capture, /id="stop"/);
  assert.doesNotMatch(capture, /id="recordings"|id="reload"/);
  assert.match(downloads, /id="recordings"/);
  assert.doesNotMatch(downloads, /id="start"|id="stop"/);
  assert.match(html, /current\.downloadRecording\(record\.id, \{ format \}\)/);
  assert.doesNotMatch(html, /停止并下载/);
});

test('quick page highlights all seven steps with links only to available browser controls', async () => {
  const html = await readFile(new URL('../web/quick-start.html', import.meta.url), 'utf8');
  const flows = [...html.matchAll(/<section\b[^>]*class="sdk-quick-flow"[^>]*aria-label="快速接入完整链路"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(flows.length, 1, 'show the complete workflow once');
  const list = flows[0][1].match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(list, 'use a semantic ordered list');
  const steps = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  const labels = ['连接产品', 'Node.js 取数', '指定端口启动 WS', '前端连接', '实时渲染', '数据采集（开始 / 停止）', '按 ID 下载'];
  const targets = [null, null, null, 'connect-form', 'view-title', 'capture-title', 'downloads-title'];
  assert.equal(steps.length, labels.length);
  for (const [index, step] of steps.entries()) {
    const number = String(index + 1).padStart(2, '0');
    assert.ok(step.includes(`<span class="sdk-flow-number" aria-hidden="true">${number}</span>`));
    assert.equal(step.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), `${number}${labels[index]}`);
    if (targets[index]) {
      assert.ok(step.includes(`href="#${targets[index]}"`));
      assert.ok(html.includes(`id="${targets[index]}"`), 'workflow links must resolve to existing controls');
    } else {
      assert.doesNotMatch(step, /<a\b/, 'backend prerequisites are not browser controls');
    }
  }
});

test('public APIs complete glove → WS → browser → labelled persistent recording → HTTP download', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-quick-flow-'));
  const source = quickSource();
  const server = await NodeShroom.serveDevice(source, { port: 0, recordingsDir: directory });
  const errors = [];
  const first = await BrowserShroom.connectStream({ url: server.url, onError: (error) => errors.push(error) });
  const second = await BrowserShroom.connectStream({ url: server.url, onError: (error) => errors.push(error) });
  t.after(async () => { await first.close(); await second.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal(first.info.product, 'handGloveFullPacket');
  const started = await first.startRecording({ label: '握拳,中文标签' });
  await assert.rejects(second.startRecording({ label: '不能并发覆盖' }), { code: 'RECORDING_ACTIVE' });
  const received = framesFrom(first, 3);
  for (let i = 0; i < 3; i++) source.emit(i);
  const frames = await received;
  assert.ok(frames[0].fingers.index.pulp.raw instanceof Uint8Array);
  assert.ok(frames[0].palm.sourceIndices instanceof Uint16Array);
  assert.deepEqual(frames[0].palm.rowLengths, [12, 15, 15, 15, 15]);
  await first.close();
  assert.equal((await second.getRecordingStatus()).status, 'recording');
  const remaining = framesFrom(second, 1);
  source.emit(9);
  await remaining;
  const stopped = await second.stopRecording();
  assert.equal(stopped.id, started.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.frameCount, 4);
  assert.equal(stopped.source, 'mock');
  const list = await second.listRecordings();
  assert.equal(list[0].label, started.label);
  const response = await fetch(second.getRecordingUrl(stopped.id, { format: 'jsonl' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.source === 'mock'));
  assert.ok(rows.every((row, i) => row.label === started.label && row.index === i && row.sessionId === started.id));
  assert.equal(rows[0].frame.fingers.index.pulp.raw.length, 1);
  const csv = await fetch(second.getRecordingUrl(stopped.id)).then((result) => result.text());
  assert.match(csv, /"握拳,中文标签"/);
  assert.match(csv, /pressureMatrix/);
  assert.equal(csv.trim().split('\r\n').length, 5);
  assert.equal(errors.length, 0);
});

test('a real ws constructor handshake timeout rejects without an unhandled closing error', async (t) => {
  const server = createServer();
  const sockets = new Set();
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', () => {}); // Keep the WS handshake pending until the client times out.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  await assert.rejects(BrowserShroom.connectStream({ url: `ws://127.0.0.1:${server.address().port}`,
    WebSocketImpl: WebSocket, timeoutMs: 25, onError() {} }), { code: 'CONNECTION_FAILED' });
  await new Promise((resolve) => setTimeout(resolve, 30));
});

test('recording status broadcasts count persisted frames before stop', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-progress-'));
  const source = quickSource();
  const server = await NodeShroom.serveDevice(source, { port: 0, recordingsDir: directory });
  const client = await BrowserShroom.connectStream({ url: server.url, onError() {} });
  t.after(async () => { await client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  await client.startRecording({ label: '实时进度' });
  const progress = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('progress timeout')); }, 2500);
    const unsubscribe = client.onRecording((recording) => {
      if (recording?.status === 'recording' && recording.frameCount === 2) { clearTimeout(timer); unsubscribe(); resolve(recording); }
    });
  });
  source.emit(1); source.emit(2);
  assert.equal((await progress).frameCount, 2);
  assert.equal((await client.stopRecording()).frameCount, 2);
});

test('base Node and Web recording URL APIs validate IDs and formats and keep downloads on the service origin', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-recording-url-'));
  let server, stream;
  t.after(async () => {
    await stream?.close(); await server?.close();
    await rm(directory, { recursive: true, force: true });
  });
  server = await NodeShroom.serveDevice(quickSource(), { port: 0, recordingsDir: directory });
  stream = await BrowserShroom.connectStream({ url: `${server.url}/ws?mode=frames`, onError() {} });
  const id = '11111111-2222-4333-8444-555555555555';
  for (const api of [server, stream]) {
    assert.equal(api.getRecordingUrl(id), `${server.httpUrl}/recordings/${id}.csv`);
    for (const format of ['csv', 'jsonl']) {
      const href = api.getRecordingUrl(id, { format });
      assert.equal(typeof href, 'string', 'URL 构造同步完成，不访问 DOM 或下载文件');
      const url = new URL(href);
      assert.equal(url.origin, server.httpUrl);
      assert.equal(url.pathname, `/recordings/${id}.${format}`);
      assert.equal(url.search, '', '下载不沿用 WS 连接的查询参数');
      assert.equal(url.hash, '');
    }
    for (const invalidId of [undefined, null, '', '../secret', `${id}/../other`, `${id}?redirect=other`,
      'https://other.example/file', 'glove', 19999, false, {}, []]) {
      assert.throws(() => api.getRecordingUrl(invalidId), { code: 'INVALID_CONFIG', stage: 'stream' });
    }
    for (const format of ['CSV', 'html', '../jsonl', '', null, false, 1]) {
      assert.throws(() => api.getRecordingUrl(id, { format }), { code: 'INVALID_CONFIG', stage: 'stream' });
    }
  }
  // 合法 UUID 即可得到 URL；记录存在性仍由原 HTTP 下载接口判断。
  assert.equal((await fetch(server.getRecordingUrl(id))).status, 404);
});

/** 下载仍使用真实 SDK 方法，仅用最小 DOM 记录浏览器发起的下载 URL。 */
function downloadEnvironment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const clicks = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { appendChild() {} },
    createElement: () => ({ click() { clicks.push(this.href); }, remove() {} }),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return clicks;
}

test('five-function browser flow records, stops and downloads exactly the completed session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-single-web-flow-'));
  const source = quickSource();
  let server, stream;
  t.after(async () => {
    await stream?.close(); await server?.close();
    await rm(directory, { recursive: true, force: true });
  });
  server = await NodeShroom.serveDevice(source, { port: 0, recordingsDir: directory });
  const errors = [], callbacks = [];
  stream = await readProduct({ url: server.url, onData: frame => callbacks.push(frame), onError: error => errors.push(error) });
  const clicks = downloadEnvironment(t);
  assert.throws(() => downloadRecording(stream), /采集|记录|record/i, '没有停止结果时不能下载');
  const first = await startRecording(stream);
  assert.equal(first.label, '本次采集');
  const received = framesFrom(stream, 2);
  source.emit(1); source.emit(2);
  await received;
  const stopped = await stopRecording(stream);
  assert.equal(stopped.id, first.id);
  assert.equal(stopped.frameCount, 2);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stream.state, 'open');
  assert.equal(callbacks.length, 2, 'onData 由快捷入口传给实际浏览器订阅');

  // 调用方修改返回对象，不能把下一次下载重定向到其他记录。
  stopped.id = 'caller-mutated-id';
  const csvUrl = downloadRecording(stream);
  assert.equal(csvUrl, `${server.httpUrl}/recordings/${first.id}.csv`);
  assert.equal(typeof csvUrl, 'string', '下载返回同步 URL，不是保存完成的 Promise');
  const csvResponse = await fetch(csvUrl);
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.ok(csv.includes(first.id));
  assert.ok(csv.includes('本次采集'));
  const jsonlUrl = downloadRecording(stream, { format: 'jsonl' });
  assert.equal(jsonlUrl, `${server.httpUrl}/recordings/${first.id}.jsonl`);
  const rows = (await fetch(jsonlUrl).then(response => response.text())).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.sessionId === first.id));
  assert.deepEqual(clicks, [csvUrl, jsonlUrl]);

  // 开始下一次采集后，不能仍把上一条停止结果当成本次下载目标。
  assert.throws(() => downloadRecording(stream, { format: 'exe' }), /format|格式|csv|jsonl/i);
  const second = await startRecording(stream, { label: '第二次抓握' });
  assert.notEqual(second.id, first.id);
  assert.throws(() => downloadRecording(stream), /采集|记录|record/i);
  const secondFrames = framesFrom(stream, 1);
  source.emit(3);
  await secondFrames;
  const secondStopped = await stopRecording(stream);
  assert.equal(secondStopped.id, second.id);
  assert.equal(secondStopped.frameCount, 1);
  assert.equal(downloadRecording(stream), `${server.httpUrl}/recordings/${second.id}.csv`);

  // 停止只结束落盘；同一个 stream 仍能接收下一帧实时数据。
  const liveAfterStop = framesFrom(stream, 1);
  source.emit(4);
  await liveAfterStop;
  assert.equal(server.getRecordingStatus().frameCount, 1);
  assert.equal(errors.length, 0);
});

test('five-function browser close disconnects viewing without stopping server recording', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-single-close-'));
  const source = quickSource();
  let server, stream;
  t.after(async () => {
    await stream?.close(); await server?.close();
    await rm(directory, { recursive: true, force: true });
  });
  server = await NodeShroom.serveDevice(source, { port: 0, recordingsDir: directory });
  stream = await readProduct({ url: server.url, onError() {} });
  const session = await startRecording(stream, { label: '退出网页后仍采集' });
  await stream.close();
  assert.equal(stream.state, 'closed');
  assert.equal(server.getRecordingStatus().status, 'recording');
  source.emit(7);
  const stopped = await server.stopRecording();
  assert.equal(stopped.id, session.id);
  assert.equal(stopped.frameCount, 1);
});

test('five-function flow rejects ambiguous connections and controllers from unrelated APIs', async () => {
  for (const field of ['product', 'path', 'side']) {
    await assert.rejects(readProduct({ url: 'ws://127.0.0.1:1', [field]: undefined }), { code: 'INVALID_CONFIG' });
  }
  for (const options of [undefined, null, [], { product: 'unregistered-product' }, { url: '' }]) {
    await assert.rejects(readProduct(options), { code: 'INVALID_CONFIG' });
  }
  const unrelated = { startRecording() { throw new Error('不应调用'); } };
  await assert.rejects(startRecording(unrelated), { code: 'INVALID_CONFIG' });
  await assert.rejects(stopRecording(unrelated), { code: 'INVALID_CONFIG' });
  assert.throws(() => downloadRecording(unrelated), { code: 'INVALID_CONFIG' });
});

test('recording commands reject overlap, release their lock after failures and preserve only stopped IDs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-flow-concurrency-'));
  const source = quickSource();
  let server, stream, secondViewer;
  t.after(async () => {
    await stream?.close(); await secondViewer?.close(); await server?.close();
    await rm(directory, { recursive: true, force: true });
  });
  server = await NodeShroom.serveDevice(source, { port: 0, recordingsDir: directory });
  stream = await readProduct({ url: server.url, onError() {} });
  secondViewer = await readProduct({ url: server.url, onError() {} });
  downloadEnvironment(t);
  await assert.rejects(stopRecording(stream), { code: 'RECORDING_NOT_ACTIVE' });
  await startRecording(stream, { label: '已完成记录' });
  const first = await stopRecording(stream);
  const firstUrl = downloadRecording(stream);
  assert.ok(firstUrl.includes(first.id));

  // WS 应答到达前门闩已经生效；失败不能删除上一次成功停止的下载目标。
  const invalidStart = startRecording(stream, { label: '' });
  const expectedFailure = assert.rejects(invalidStart, { code: 'INVALID_CONFIG' });
  assert.throws(() => downloadRecording(stream), { code: 'INVALID_REQUEST' });
  const duplicateStart = assert.rejects(startRecording(stream), { code: 'INVALID_REQUEST' });
  const overlappingStop = assert.rejects(stopRecording(stream), { code: 'INVALID_REQUEST' });
  assert.throws(() => downloadRecording(secondViewer), { code: 'RECORDING_NOT_ACTIVE' }, '其他连接不继承当前连接的门闩或记录 ID');
  await Promise.all([expectedFailure, duplicateStart, overlappingStop]);
  assert.equal(downloadRecording(stream), firstUrl);

  const starting = startRecording(stream, { label: '第二次有效记录' });
  assert.throws(() => downloadRecording(stream), { code: 'INVALID_REQUEST' });
  await starting;
  assert.throws(() => downloadRecording(stream), { code: 'RECORDING_NOT_ACTIVE' });
  const stopping = stopRecording(stream);
  assert.throws(() => downloadRecording(stream), { code: 'INVALID_REQUEST' });
  await assert.rejects(startRecording(stream), { code: 'INVALID_REQUEST' });
  const second = await stopping;
  assert.notEqual(second.id, first.id);
  assert.ok(downloadRecording(stream).includes(second.id));
  assert.equal((await stopRecording(stream)).id, second.id, '底层停止接口允许重复确认同一已完成记录');
  assert.ok(downloadRecording(stream).includes(second.id));
});

/** 仅替换原生串口驱动，保留产品拆帧、WS 服务、录制及下载的真实实现。 */
class FlowNodePort extends EventEmitter {
  static instances = [];
  static async list() { return [{ path: 'FLOW_COM' }]; }
  constructor(options) {
    super(); this.options = options; this.isOpen = false; this.closeCalls = 0;
    FlowNodePort.instances.push(this);
  }
  open(callback) { queueMicrotask(() => { this.isOpen = true; callback(null); }); }
  close(callback) {
    this.closeCalls += 1; this.isOpen = false; this.emit('close'); callback(null);
  }
}

test('five-function Node flow connects registered products and releases every owned resource', {
  skip: typeof nodeModule.registerHooks !== 'function' ? '串口依赖夹具需要 Node 22.15+' : false,
}, async t => {
  const stubKey = Symbol.for('shroom.single-flow.test.serialport');
  globalThis[stubKey] = FlowNodePort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.single-flow.test.serialport")];')}`;
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; });

  for (const product of ['glove', 'pad']) await t.test(`${product} 数据进入真实 WS，采集下载并释放串口和监听端口`, async child => {
    const directory = await mkdtemp(join(tmpdir(), 'shroom-single-node-flow-'));
    FlowNodePort.instances = [];
    const acquired = [], errors = [];
    let device, server, stream;
    child.after(async () => {
      await stream?.close(); await server?.close(); await device?.close();
      await rm(directory, { recursive: true, force: true });
    });
    device = await readProduct({ product, ...(product === 'glove' ? { side: 'right' } : {}), path: 'FLOW_COM',
      onData: frame => acquired.push(frame), onError: error => errors.push(error) });
    server = await createWS(device, { port: 0, recordingsDir: directory });
    const port = FlowNodePort.instances[0];
    assert.equal(device.info.product, product === 'glove' ? 'handGloveFullPacket' : 'hand');
    assert.equal(port.options.path, 'FLOW_COM');
    assert.equal(port.options.baudRate, product === 'glove' ? 921600 : 1000000);
    stream = await readProduct({ url: server.url, onError: error => errors.push(error) });
    const session = await startRecording(server, { label: `${product} 采集` });
    const received = framesFrom(stream, 1);
    const payload = product === 'glove'
      ? Uint8Array.from({ length: 274 }, (_, index) => index & 255)
      : Uint8Array.from({ length: 1024 }, (_, index) => index % 251);
    port.emit('data', Uint8Array.from([...payload, 0xaa, 0x55, 0x03, 0x99]));
    const [frame] = await received;
    assert.equal(acquired.length, 1);
    assert.equal(frame.product, device.info.product);
    if (product === 'glove') assert.equal(frame.side, 'right');
    else assert.equal(frame.pressureMatrix.length, 1024);
    assert.equal(errors.length, 0);
    const recording = await stopRecording(server);
    assert.equal(recording.id, session.id);
    assert.equal(recording.frameCount, 1);
    recording.id = 'changed-by-caller';
    const downloadUrl = downloadRecording(server, { format: 'jsonl' });
    assert.equal(downloadUrl, `${server.httpUrl}/recordings/${session.id}.jsonl`);
    const row = JSON.parse((await fetch(downloadUrl).then(response => response.text())).trim());
    assert.equal(row.sessionId, session.id);
    assert.equal(row.frame.product, device.info.product);
    await stream.close();
    await Promise.all([server.close(), server.close()]);
    assert.equal(device.state, 'closed');
    assert.equal(port.closeCalls, 1);
    await assert.rejects(startRecording(server), { code: 'SERVER_CLOSED' });
    await assert.rejects(stopRecording(server), { code: 'SERVER_CLOSED' });
    assert.throws(() => downloadRecording(server), { code: 'SERVER_CLOSED' });
    await assert.rejects(fetch(`${server.httpUrl}/health`));
  });

  await t.test('服务启动失败时关闭刚打开的串口', async child => {
    const directory = await mkdtemp(join(tmpdir(), 'shroom-single-node-fail-'));
    child.after(() => rm(directory, { recursive: true, force: true }));
    FlowNodePort.instances = [];
    const device = await readProduct({ product: 'pad', path: 'FLOW_COM' });
    await assert.rejects(createWS(device, { port: -1, recordingsDir: directory }), { code: 'INVALID_CONFIG' });
    assert.equal(FlowNodePort.instances.length, 1);
    assert.equal(FlowNodePort.instances[0].isOpen, false);
    assert.equal(FlowNodePort.instances[0].closeCalls, 1);
  });

  await t.test('设备关闭抛错时仍关闭服务并保留错误', async child => {
    const directory = await mkdtemp(join(tmpdir(), 'shroom-single-node-close-'));
    FlowNodePort.instances = [];
    let device, server;
    child.after(async () => {
      await server?.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
    });
    device = await readProduct({ product: 'pad', path: 'FLOW_COM' });
    server = await createWS(device, { port: 0, recordingsDir: directory });
    const closeDevice = device.close.bind(device);
    const failure = new Error('测试设备收尾失败');
    device.close = async () => { await closeDevice(); throw failure; };
    await assert.rejects(server.close(), error => error === failure);
    assert.equal(FlowNodePort.instances[0].closeCalls, 1);
    assert.equal(device.state, 'closed');
    await assert.rejects(fetch(`${server.httpUrl}/health`));
  });

  await t.test('服务启动与设备清理都失败时保留两个错误', async child => {
    const directory = await mkdtemp(join(tmpdir(), 'shroom-single-node-close-both-'));
    FlowNodePort.instances = [];
    child.after(() => rm(directory, { recursive: true, force: true }));
    const device = await readProduct({ product: 'pad', path: 'FLOW_COM' });
    const closeDevice = device.close.bind(device);
    const deviceFailure = new Error('测试设备关闭失败');
    // 先真实释放串口再模拟清理异常，验证错误合并时也不遗留句柄。
    device.close = async () => { await closeDevice(); throw deviceFailure; };
    await assert.rejects(createWS(device, { port: -1, recordingsDir: directory }), error => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0].code, 'INVALID_CONFIG');
      assert.equal(error.errors[1], deviceFailure);
      assert.equal(error.cause, error.errors[0]);
      return true;
    });
    assert.equal(FlowNodePort.instances[0].closeCalls, 1);
    assert.equal(device.state, 'closed');
  });
});
