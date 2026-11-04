/**
 * npm 客户安装检查：只从临时项目的 node_modules 使用真实 .tgz，不借用源码入口。
 * 模拟设备代替硬件；WS、SQLite、HTTP 导出与原生依赖均实际运行。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyNpmArchive } from './npm-archive.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);

/** 0.2.x 注册表消费检查仍走原契约；未发布的新产品只要求 0.3.0 及以后版本具备。 */
function supportsNewProducts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version);
  if (!match) throw new Error('无法判断 npm 验收版本：' + version);
  const [, major, minor, patch, prerelease] = match;
  return Number(major) > 0 || Number(minor) > 3
    || (Number(minor) === 3 && (Number(patch) > 0 || !prerelease));
}

/** 分包手套从 0.4.0 起提供；仍允许对旧的 0.3.x 发布包做独立验收。 */
function supportsSegmentedGlove(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version);
  if (!match) throw new Error('无法判断 npm 验收版本：' + version);
  const [, major, minor, patch, prerelease] = match;
  return Number(major) > 0 || Number(minor) > 4
    || (Number(minor) === 4 && (Number(patch) > 0 || !prerelease));
}

/** 不经过 shell，Windows 上同样以参数数组启动 npm。 */
async function npmCli() {
  const binary = dirname(process.execPath);
  for (const candidate of [process.env.npm_execpath,
    join(binary, 'node_modules/npm/bin/npm-cli.js'),
    resolve(binary, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* 下一个已知安装位置。 */ }
  }
  throw new Error('找不到 npm CLI；请使用 npm run test:npm。');
}

async function execute(args, { cwd, env, label, timeout = 180000 }) {
  try {
    const { stdout } = await runFile(process.execPath, args, {
      cwd, env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    if (stdout.trim()) console.log(stdout.trim());
  } catch (error) {
    throw new Error(`${label}失败：\n${[error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message}`, { cause: error });
  }
}

/** 安装结果只允许精简运行库、公开类型与客户说明，不能夹带开发文件或采集数据。 */
async function inspectInstalledPackage(root, version) {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.name, 'shroom-sdk');
  assert.equal(metadata.version, version);
  assert.equal(metadata.type, 'module');
  assert.equal(metadata.private, false, '客户安装包应允许 npm 注册表发布');
  assert.equal(metadata.publishConfig?.access, 'public');
  assert.equal(metadata.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.ok(!metadata.scripts && !metadata.devDependencies, '客户安装包不能带开发脚本或开发依赖');
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), '安装包不能通过符号链接夹带外部文件');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(root, path).split(sep).join('/'));
    }
  }
  await walk(root);
  for (const file of files) {
    assert.ok(/^(?:package\.json|README\.md|CHANGELOG\.md|MIGRATION\.md|LICENSE(?:\.(?:md|txt))?)$/.test(file)
      || /^(?:runtime|browser)\/[\w./-]+(?:\.js|\.d\.ts)$/.test(file), `npm 包出现非交付文件：${file}`);
    assert.ok(!/(?:^|\/)(?:tests?|scripts|examples|python|node_modules|work)(?:\/|$)|\.map$|\.sqlite|\.env/.test(file),
      `npm 包不能包含开发/采集文件：${file}`);
    if (file.endsWith('.js')) {
      const source = await readFile(join(root, file), 'utf8');
      assert.doesNotMatch(source, /sourceMappingURL\s*=|\/\*\*/, `运行产物不应带源映射或源码文档注释：${file}`);
    }
  }
  return { metadata, files };
}

const BROWSER_ENTRY = `
export * as flow from 'shroom-sdk/quick-flow';
export * as web from 'shroom-sdk/web';
export * as root from 'shroom-sdk';
export * as backend from 'shroom-sdk/backend';
export * as core from 'shroom-sdk/core';
`;

// 单独子进程加载原生 SQLite，退出之后再清理临时目录，避免 Windows DLL 锁定。
const NODE_SMOKE = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as root from 'shroom-sdk';
import * as web from 'shroom-sdk/web';
import * as node from 'shroom-sdk/node';
import * as flow from 'shroom-sdk/quick-flow';
import * as backend from 'shroom-sdk/backend';
import * as core from 'shroom-sdk/core';

const [recordingsDir, expectedVersion, browserBundle] = process.argv.slice(2);
${supportsNewProducts.toString()}
${supportsSegmentedGlove.toString()}
const checkExpandedProducts = supportsNewProducts(expectedVersion);
const checkSegmentedGlove = supportsSegmentedGlove(expectedVersion);
const names = ['createWS', 'downloadRecording', 'readProduct', 'startRecording', 'stopRecording'];
assert.deepEqual(Object.keys(flow).sort(), names);
for (const name of names) assert.equal(typeof flow[name], 'function');
assert.equal(node.Shroom.version, expectedVersion);
assert.equal(root.Shroom, web.Shroom);
assert.equal(node.Shroom.mock, web.Shroom.mock, 'Node/Web 必须共享 mock 身份');
assert.equal(node.activateLicense, web.activateLicense, '授权状态必须在基础入口之间共享');
assert.equal(node.ShroomError, web.ShroomError);
assert.equal(core.decodeFrame, node.decodeFrame);
assert.equal(typeof backend.BackendSdkClient, 'function');
assert.equal(typeof node.listPorts, 'function');
assert.equal(node.listPorts, node.Shroom.listPorts);

const require = createRequire(import.meta.url);
assert.equal(typeof require('serialport').SerialPort, 'function');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
try { assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1); } finally { db.close(); }

// 使用测试进程临时签发的离线密钥确认跨入口共享状态，不访问实际授权后台。
const issuer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = issuer.publicKey.export({ type: 'spki', format: 'pem' });
const payload = Buffer.from(JSON.stringify({ productType: 'shroom-sdk', boundSensorTypes: 'all',
  sdkFeatures: ['serial', 'serial.raw', 'stream', 'recording'], expireDate: Date.now() + 60000, version: 3 })).toString('base64');
const key = Buffer.from(JSON.stringify({ payload,
  signature: sign('RSA-SHA256', Buffer.from(payload), issuer.privateKey).toString('base64') })).toString('base64');
await node.activateLicense(key, { mode: 'offline', publicKey });
assert.equal(web.getLicenseStatus().valid, true);
web.clearLicense();
assert.equal(node.getLicenseStatus().valid, false);

await assert.rejects(flow.readProduct({ url: 'https://invalid.example' }), error =>
  error instanceof node.ShroomError && error.code === 'INVALID_CONFIG' && typeof error.suggestion === 'string');
await assert.rejects(flow.readProduct({ product: 'pad', path: 'SHROOM_TEST_NO_DEVICE' }), { code: 'LICENSE_REQUIRED' });
assert.throws(() => flow.downloadRecording({}), { code: 'INVALID_CONFIG' });

// 真实浏览器条件产物放入没有 process/require/Buffer 的沙箱，仅注入标准 Web API。
let downloaded = null;
const browser = { console, URL, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
  setTimeout, clearTimeout, setInterval, clearInterval, AbortController, WebSocket,
  document: { body: { appendChild() {} }, createElement() {
    return { click() { downloaded = this.href; }, remove() {} };
  } } };
runInNewContext(await readFile(browserBundle, 'utf8'), browser, { timeout: 5000 });
const consumer = browser.ShroomConsumer;
assert.deepEqual(Object.keys(consumer.flow).sort(), names);
assert.equal(consumer.root.Shroom, consumer.web.Shroom);
assert.equal(consumer.root.activateLicense, consumer.web.activateLicense);
assert.equal(consumer.backend.BackendSdkClient, consumer.web.BackendSdkClient);
assert.equal(consumer.core.decodeFrame, consumer.web.decodeFrame);
await consumer.web.activateLicense(key, { mode: 'offline', publicKey });
assert.equal(consumer.root.getLicenseStatus().valid, true);
consumer.root.clearLicense();
assert.equal(consumer.web.getLicenseStatus().valid, false);
await assert.rejects(consumer.flow.readProduct({ product: 'pad' }), { code: 'UNSUPPORTED_ENVIRONMENT' });
let closedUnsupported = false;
await assert.rejects(consumer.flow.createWS({ async close() { closedUnsupported = true; } }), { code: 'UNSUPPORTED_ENVIRONMENT' });
assert.equal(closedUnsupported, true);

// 安装包的真实公开基础入口解析合成串口字节，随后跨 Node/浏览器 WS 编解码。
// 不导入 runtime 内部适配器、不访问硬件或授权后台；同时覆盖 browser 条件产物。
if (checkExpandedProducts) {
  const products = ['hand', 'handGloveFullPacket', 'humanBody', 'jqInsole', ...(checkSegmentedGlove ? ['handGloveSegmented'] : [])].sort();
  for (const entry of [root, web, node, consumer.root, consumer.web]) {
    assert.deepEqual(Array.from(entry.listDeviceProducts(), profile => profile.product).sort(), products);
    assert.deepEqual(Array.from(entry.Shroom.listDeviceProducts(), profile => profile.product).sort(), products);
  }
  const bodyAdc = Uint8Array.from({ length: 1024 }, (_, i) => (i * 19 + 7) % 256);
  const header = [0xaa, 0x55, 0x03, 0x99];
  function insoleSample(protocol) {
    const is12 = protocol === '12bit';
    const bytes = new Uint8Array(is12 ? 552 : 272);
    const view = new DataView(bytes.buffer);
    const adc = Array.from({ length: 256 }, (_, i) => is12 ? i * 16 + 15 : i);
    for (let i = 0; i < adc.length; i++) {
      if (is12) view.setUint16(i * 2, adc[i], true);
      else bytes[i] = adc[i];
    }
    const imu = is12 ? [1, -0.25, 0.5, 0, -2, 3, -4, 5, -6, 7] : [1, -0.25, 0.5, 0];
    imu.forEach((value, i) => view.setFloat32((is12 ? 512 : 256) + i * 4, value, true));
    return { adc, wire: Uint8Array.from(is12 ? [...header, ...bytes]
      : [...header, 1, 31, ...bytes.subarray(0, 128), ...header, 2, 31, ...bytes.subarray(128)]) };
  }
  function gloveSample(side) {
    const packetType = 2; // 单手单串口：相同类型也能对应左/右手，side 决定点位映射。
    const adc = Array.from({ length: 256 }, (_, i) => i % 251);
    const imu = new Uint8Array(16);
    const view = new DataView(imu.buffer);
    [1, -0.25, 0.5, 0].forEach((value, i) => view.setFloat32(i * 4, value, true));
    return { adc, imu, packetType,
      wire: Uint8Array.from([1, packetType, ...adc.slice(0, 128), ...header,
        2, packetType, ...adc.slice(128), ...imu, ...header]) };
  }
  const browserBytes = runInNewContext('Uint8Array', browser);
  const typed = (value, name) => assert.equal(Object.prototype.toString.call(value), '[object ' + name + ']');
  browser.navigator = { serial: { async requestPort() { throw new Error('验收必须使用显式模拟端口'); } } };
  await consumer.web.activateLicense(key, { mode: 'offline', publicKey });
  try {
    for (const config of [
      ...(checkSegmentedGlove ? [{ product: 'glove', side: 'left' }, { product: 'handGloveSegmented', side: 'right' }] : []),
      { product: 'body' },
      { product: 'insole', side: 'left', protocol: '12bit', baudRate: 1500000 },
      { product: 'jqInsole', side: 'right', protocol: '8bit' },
    ]) {
      const isBody = config.product === 'body';
      const isGlove = ['glove', 'handGloveSegmented'].includes(config.product);
      const sample = isBody ? { adc: Array.from(bodyAdc), wire: Uint8Array.from([...bodyAdc, ...header]) }
        : isGlove ? gloveSample(config.side) : insoleSample(config.protocol);
      const chunks = [];
      for (let i = 0; i < sample.wire.length; i += 13) chunks.push(new browserBytes(sample.wire.subarray(i, i + 13)));
      let chunkIndex = 0, finishRead, closed = 0, baudRate;
      const reader = {
        read() {
          if (chunkIndex < chunks.length) return Promise.resolve({ value: chunks[chunkIndex++], done: false });
          return new Promise(resolveRead => { finishRead = resolveRead; });
        },
        async cancel() { finishRead?.({ done: true }); },
        releaseLock() {},
      };
      const port = {
        readable: { getReader: () => reader },
        async open(options) { baudRate = options.baudRate; },
        async close() { closed++; },
      };
      let resolveFrame, rejectFrame, timer, productDevice;
      const errors = [];
      const received = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
      try {
        const connect = config.product === 'glove' ? consumer.web.connectGlove : consumer.web.connectProduct;
        productDevice = await connect({ ...config, port,
          onData: resolveFrame, onError(error) { errors.push(error); rejectFrame(error); } });
        timer = setTimeout(() => rejectFrame(new Error('安装包新产品合成帧超时')), 5000);
        const frame = await received;
        assert.equal(baudRate, config.baudRate ?? (isBody ? 1000000 : 921600));
        const encodedBrowser = consumer.web.encodeStreamFrame(frame);
        const restoredNode = node.decodeStreamFrame(JSON.parse(JSON.stringify(encodedBrowser)));
        const encodedNode = node.encodeStreamFrame(restoredNode);
        const restoredBrowser = consumer.web.decodeStreamFrame(JSON.parse(JSON.stringify(encodedNode)));
        assert.deepEqual(JSON.parse(JSON.stringify(consumer.web.encodeStreamFrame(restoredBrowser))),
          JSON.parse(JSON.stringify(encodedBrowser)), '安装包 Node/浏览器必须保留同一产品帧');
        for (const copy of [frame, restoredNode, restoredBrowser]) {
          assert.deepEqual(Array.from(copy.pressure), sample.adc);
          typed(copy.raw, 'Uint8Array'); typed(copy.values, 'Float32Array');
          if (isGlove) {
            assert.equal(copy.product, 'handGloveSegmented');
            assert.equal(copy.protocol, 'segmented');
            assert.equal(copy.side, config.side);
            assert.equal(copy.packetType, sample.packetType);
            assert.equal('sequence' in copy, false, '分包无设备帧号，不能伪造 sequence');
            assert.equal(copy.raw.length, 256);
            assert.equal(copy.palm.raw.length, 72);
            assert.equal(Object.keys(copy.fingers).length, 5);
            assert.deepEqual(Array.from(copy.imu.raw), Array.from(sample.imu));
            typed(copy.pressure, 'Uint8Array'); typed(copy.pressureMatrix, 'Uint8Array');
          } else if (isBody) {
            assert.equal(copy.product, 'humanBody');
            typed(copy.pressure, 'Uint8Array'); typed(copy.pressureMatrix, 'Uint8Array');
            assert.equal(copy.raw.length, 1024);
            assert.equal(Object.keys(copy.regions).length, 10);
            const indices = [];
            for (const region of Object.values(copy.regions)) {
              typed(region.sourceIndices, 'Uint16Array'); typed(region.raw, 'Uint8Array'); typed(region.values, 'Float32Array');
              assert.equal(region.raw.length, region.rows * region.cols);
              assert.deepEqual(Array.from(region.raw), Array.from(region.sourceIndices, index => bodyAdc[index]));
              indices.push(...region.sourceIndices);
            }
            assert.equal(indices.length, 400); assert.equal(new Set(indices).size, 400);
            assert.equal(copy.regions.back.sourceIndices[0], 618);
          } else {
            const is12 = config.protocol === '12bit';
            assert.equal(copy.product, 'jqInsole'); assert.equal(copy.side, config.side); assert.equal(copy.protocol, config.protocol);
            typed(copy.pressure, is12 ? 'Uint16Array' : 'Uint8Array');
            typed(copy.pressureMatrix, is12 ? 'Uint16Array' : 'Uint8Array');
            typed(copy.sensors.raw, is12 ? 'Uint16Array' : 'Uint8Array');
            typed(copy.sensors.sourceIndices, 'Uint16Array'); typed(copy.sensors.values, 'Float32Array');
            typed(copy.imu.raw, 'Uint8Array'); typed(copy.imu.quaternion, 'Float32Array');
            assert.equal(copy.raw.length, is12 ? 512 : 256);
            assert.equal(copy.pressure[255], is12 ? 4095 : 255);
            assert.equal(copy.sensors.raw.length, 112); assert.equal(copy.sensors.positions.length, 112);
            assert.equal(copy.sensors.sourceIndices[0], config.side === 'left' ? 141 : 114);
            assert.deepEqual(Array.from(copy.sensors.raw), Array.from(copy.sensors.sourceIndices, index => sample.adc[index]));
            assert.equal(copy.imu.raw.length, is12 ? 40 : 16);
            assert.deepEqual(Array.from(copy.imu.quaternion), [1, -0.25, 0.5, 0]);
            if (is12) {
              typed(copy.imu.gyroscope, 'Float32Array'); typed(copy.imu.acceleration, 'Float32Array');
              assert.deepEqual(Array.from(copy.imu.gyroscope), [-2, 3, -4]);
              assert.deepEqual(Array.from(copy.imu.acceleration), [5, -6, 7]);
              assert.equal(copy.sequence, undefined);
            } else {
              assert.equal(copy.sequence, 31);
              assert.equal(copy.imu.gyroscope, undefined); assert.equal(copy.imu.acceleration, undefined);
            }
          }
        }
        assert.deepEqual(errors, []);
      } finally {
        clearTimeout(timer);
        await productDevice?.close();
      }
      assert.equal(closed, 1, '每个合成串口都必须完整释放');
    }
    console.log('npm 产品注册、' + (checkSegmentedGlove ? '分包手套左右手、' : '') + '人体400通道、鞋垫双协议精度与 Node/浏览器 WS 编解码通过。');
  } finally {
    consumer.web.clearLicense();
    delete browser.navigator;
  }
}

function waitFrames(stream) {
  return new Promise((done, reject) => {
    let count = 0;
    let removeData = () => {};
    let removeError = () => {};
    const finish = (error) => { clearTimeout(timer); removeData(); removeError(); error ? reject(error) : done(); };
    const timer = setTimeout(() => finish(new Error('npm 客户未收到 WS 模拟数据')), 5000);
    removeError = stream.onError(finish);
    removeData = stream.onData(frame => {
      try { assert.equal(frame.raw.length, 4); if (++count === 3) finish(); }
      catch (error) { finish(error); }
    });
  });
}

const device = node.Shroom.mock({ rows: 2, cols: 2, fps: 100 });
let server;
let stream;
let browserStream;
try {
  server = await flow.createWS(device, { port: 0, recordingsDir });
  stream = await flow.readProduct({ url: server.url, WebSocketImpl: WebSocket });
  const started = await flow.startRecording(server, { label: 'npm 安装采集验证' });
  await waitFrames(stream);
  const stopped = await flow.stopRecording(server);
  assert.equal(stopped.id, started.id);
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.frameCount >= 3);
  const response = await fetch(flow.downloadRecording(server, { format: 'jsonl' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, stopped.frameCount);
  assert.ok(rows.every(row => row.sessionId === started.id && row.label === 'npm 安装采集验证' && row.source === 'mock'));
  const csv = await fetch(flow.downloadRecording(server, { format: 'csv' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(started.id));

  browserStream = await consumer.flow.readProduct({ url: server.url });
  const browserStarted = await consumer.flow.startRecording(browserStream, { label: 'npm 浏览器采集验证' });
  await waitFrames(browserStream);
  const browserStopped = await consumer.flow.stopRecording(browserStream);
  assert.equal(browserStopped.id, browserStarted.id);
  assert.ok(browserStopped.frameCount >= 3);
  const url = consumer.flow.downloadRecording(browserStream, { format: 'csv' });
  assert.equal(downloaded, url);
  const browserCsv = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(browserCsv.status, 200);
  assert.ok((await browserCsv.text()).includes(browserStarted.id));
  console.log('npm 包名导入、授权单例、错误处理、Node/浏览器五步流程及 CSV/JSONL 下载通过：' + expectedVersion);
} finally {
  try { await browserStream?.close(); }
  finally {
    try { await stream?.close(); }
    finally {
      try { await server?.close(); } finally { await device.close(); }
    }
  }
}
assert.equal(device.state, 'closed');
assert.equal((await readFile(join(recordingsDir, 'recordings.sqlite'))).subarray(0, 16).toString(), 'SQLite format 3\0');
`;

const TYPES_CONSUMER = `
import { Shroom, type Frame } from 'shroom-sdk';
import { Shroom as NodeShroom, listPorts } from 'shroom-sdk/node';
import { Shroom as WebShroom } from 'shroom-sdk/web';
import { BackendSdkClient } from 'shroom-sdk/backend';
import { decodeFrame } from 'shroom-sdk/core';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from 'shroom-sdk/quick-flow';
const server = await createWS(NodeShroom.mock({ rows: 2, cols: 2 }));
const ports = await listPorts();
const device = await readProduct({ product: 'pad', path: ports[0]?.path ?? 'COM_TEST',
  reconnect: { intervalMs: 3000, maxAttempts: 3 },
  onStateChange(status) { console.log(status.state, status.attempt); } });
const unsubscribe = device.onStateChange(status => console.log(status.path));
unsubscribe();
await device.close();
const stream = await readProduct({ url: server.url, onData(frame: Frame) { console.log(frame.values); } });
await startRecording(stream, { label: '类型检查' });
await stopRecording(stream);
const url: string = downloadRecording(stream, { format: 'csv' });
const client = new BackendSdkClient();
console.log(url, client, Shroom.version, WebShroom.version, decodeFrame);
await stream.close();
await server.close();
// @ts-expect-error 五步函数仍拒绝未支持的下载格式。
downloadRecording(stream, { format: 'xlsx' });
// @ts-expect-error URL 连接不能混入串口产品参数。
await readProduct({ url: 'ws://127.0.0.1:19999', product: 'pad' });
// @ts-expect-error 串口重连配置不能用于 WS 客户端。
await readProduct({ url: 'ws://127.0.0.1:19999', reconnect: true });
`;

// 与运行验收共用版本门槛，不要求已发布的 0.2.x 包导出未来版本类型。
const NEW_PRODUCT_TYPES_CONSUMER = `
import type { HumanBodyFrame, InsoleFrame, Insole12BitFrame, Insole8BitFrame } from 'shroom-sdk';
const body = await readProduct({ product: 'body', path: 'COM_TEST', onData(frame) {
  const typedFrame: HumanBodyFrame = frame;
  const indices: Uint16Array = typedFrame.regions.back.sourceIndices;
  const raw: Uint8Array = typedFrame.regions.back.raw;
  console.log(indices, raw);
} });
await body.close();
const insole = await readProduct({ product: 'insole', path: 'COM_TEST', side: 'left', protocol: '12bit', baudRate: 1500000,
  onData(frame) {
    const typedFrame: InsoleFrame = frame;
    const rawBytes: Uint8Array = typedFrame.raw;
    const quaternion: Float32Array = typedFrame.imu.quaternion;
    if (typedFrame.protocol === '12bit') {
      const precise: Insole12BitFrame = typedFrame;
      const adc: Uint16Array = precise.pressure;
      const sensors: Uint16Array = precise.sensors.raw;
      const gyro: Float32Array = precise.imu.gyroscope;
      const scale: 4095 = precise.fullScale;
      console.log(adc, sensors, gyro, scale);
    } else {
      const byteFrame: Insole8BitFrame = typedFrame;
      const adc: Uint8Array = byteFrame.pressure;
      const sequence: number = byteFrame.sequence;
      console.log(adc, sequence);
      // @ts-expect-error 8-bit 帧没有陀螺仪测量值，不能凭空补零。
      console.log(byteFrame.imu.gyroscope);
    }
    console.log(rawBytes, quaternion);
  } });
await insole.close();
const browserInsole = await WebShroom.connectProduct({ product: 'jqInsole', side: 'right', protocol: '8bit',
  onData(frame) { const values: Float32Array = frame.sensors.values; console.log(values); } });
await browserInsole.close();
const productStream = await readProduct<HumanBodyFrame | InsoleFrame>({ url: 'ws://127.0.0.1:19999', onData(frame) {
  if (frame.product === 'humanBody') console.log(frame.regions.back.raw);
  else console.log(frame.sensors.raw, frame.imu.quaternion);
} });
await productStream.close();
// @ts-expect-error 鞋垫必须明确脚侧。
await readProduct({ product: 'insole', path: 'COM_TEST' });
// @ts-expect-error 鞋垫只支持已确认的协议。
await readProduct({ product: 'insole', side: 'left', protocol: 'auto', path: 'COM_TEST' });
// @ts-expect-error 鞋垫不支持任意波特率。
await readProduct({ product: 'insole', side: 'left', baudRate: 1000000, path: 'COM_TEST' });
// @ts-expect-error 人体协议不接受脚侧。
await readProduct({ product: 'body', side: 'left', path: 'COM_TEST' });
// @ts-expect-error 人体不能覆盖固定协议。
await readProduct({ product: 'body', protocol: '12bit', path: 'COM_TEST' });
`;

const SEGMENTED_GLOVE_TYPES_CONSUMER = `
import type { SegmentedGloveFrame, GloveFrame } from 'shroom-sdk';
const segmented = await readProduct({ product: 'glove', side: 'left', onData(frame) {
  const typed: SegmentedGloveFrame = frame;
  const protocol: 'segmented' = typed.protocol;
  const packetType: number = typed.packetType;
  // @ts-expect-error 分包协议没有设备帧号。
  const sequence: number = typed.sequence;
  console.log(protocol, packetType, sequence, typed.fingers);
} });
await segmented.close();
const explicitSegments = await WebShroom.connectProduct({ product: 'handGloveSegmented', side: 'right' });
explicitSegments.onData(frame => { const typed: SegmentedGloveFrame = frame; console.log(typed.palm); });
await explicitSegments.close();
const legacy = await readProduct({ product: 'handGloveFullPacket', side: 'left', onData(frame) {
  const typed: GloveFrame = frame;
  const sequence: number = typed.sequence;
  console.log(sequence);
} });
await legacy.close();
`;

export async function checkNpmPackage({ projectRoot = ROOT, packagePath, fromRegistry = false } = {}) {
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const archive = resolve(packagePath ?? join(projectRoot, 'dist', `shroom-sdk-${version}.tgz`));
  const archiveBytes = await readFile(archive);
  verifyNpmArchive(archiveBytes, version, { requirePublishable: true });
  const npm = await npmCli();
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'shroom-npm-consumer-'));
  try {
    const consumer = join(temporary, 'consumer');
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'shroom-install-check', private: true, type: 'module' }));
    const env = { ...process.env, npm_config_cache: join(temporary, 'npm-cache'),
      npm_config_devdir: join(temporary, 'node-gyp'), npm_config_fetch_retries: '1',
      npm_config_fetch_timeout: '30000', npm_config_update_notifier: 'false',
      TMPDIR: temporary, TEMP: temporary, TMP: temporary };
    const specifier = fromRegistry ? `shroom-sdk@${version}` : archive;
    console.log('检查 npm 交付包：在独立客户项目安装 ' + (fromRegistry ? specifier : basename(archive)));
    await execute([npm, 'install', '--save-exact', '--no-audit', '--no-fund', '--loglevel=error',
      '--registry=https://registry.npmjs.org/', specifier],
      { cwd: consumer, env, label: 'npm 安装交付包' });
    const installed = join(consumer, 'node_modules/shroom-sdk');
    const { files } = await inspectInstalledPackage(installed, version);
    const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/shroom-sdk'].version, version);
    assert.ok(lock.packages['node_modules/shroom-sdk'].integrity, '客户锁文件必须记录安装包完整性');
    assert.equal(lock.packages['node_modules/shroom-sdk'].integrity,
      'sha512-' + createHash('sha512').update(archiveBytes).digest('base64'), '安装内容必须与通过验证的发布包一致');
    if (fromRegistry) assert.equal(new URL(lock.packages['node_modules/shroom-sdk'].resolved).origin,
      'https://registry.npmjs.org', '客户必须从 npm 官方注册表获取包');

    await writeFile(join(consumer, 'browser-entry.js'), BROWSER_ENTRY);
    const browserBundle = join(consumer, 'browser-bundle.js');
    const browserBuild = await build({ absWorkingDir: consumer, entryPoints: ['browser-entry.js'],
      outfile: browserBundle, bundle: true, platform: 'browser', format: 'iife', globalName: 'ShroomConsumer',
      target: 'es2022', metafile: true, logLevel: 'silent' });
    for (const input of Object.keys(browserBuild.metafile.inputs)) {
      assert.ok(!/runtime\/node\/|node_modules\/(?:serialport|ws|better-sqlite3)\//.test(input.replace(/\\/g, '/')),
        `浏览器包不能包含 Node 运行模块：${input}`);
    }
    assert.ok(Object.values(browserBuild.metafile.outputs).every(output => output.imports.length === 0),
      '浏览器打包结果不能残留 Node 内建模块或未解析依赖');
    await writeFile(join(consumer, 'smoke.mjs'), NODE_SMOKE);
    await execute(['smoke.mjs', join(temporary, 'recordings'), version, browserBundle],
      { cwd: consumer, env, label: 'npm 消费者五步流程', timeout: 30000 });

    await writeFile(join(consumer, 'types.mts'), TYPES_CONSUMER
      + (supportsNewProducts(version) ? NEW_PRODUCT_TYPES_CONSUMER : '')
      + (supportsSegmentedGlove(version) ? SEGMENTED_GLOVE_TYPES_CONSUMER : ''));
    for (const [module, moduleResolution, types] of [['NodeNext', 'NodeNext', ['node']], ['ESNext', 'Bundler', []]]) {
      const config = { compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module, moduleResolution, strict: true, noEmit: true, skipLibCheck: false, types,
        typeRoots: [join(projectRoot, 'node_modules/@types')] }, files: ['types.mts'] };
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify(config));
      await execute([join(projectRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
        { cwd: consumer, env, label: `${moduleResolution} 客户类型声明`, timeout: 30000 });
    }
    console.log(`npm 包结构、${files.length} 个交付文件及 NodeNext/Bundler 类型检查通过。`);
    return { version, packagePath: archive, files };
  } finally {
    const target = resolve(temporary);
    assert.ok(target.startsWith(temporaryRoot + sep) && basename(target).startsWith('shroom-npm-consumer-'),
      '只能清理本检查创建的临时子目录');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkNpmPackage({ fromRegistry: process.argv.includes('--from-registry') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
