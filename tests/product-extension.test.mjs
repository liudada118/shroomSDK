import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';
import { runInNewContext } from 'node:vm';
import { activateTestLicense, licenseBrowserGlobals } from './license-fixture.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const sdkSource = fileURLToPath(new URL('../', import.meta.url));
const runFile = promisify(execFile);

// 第三个产品完全位于临时 SDK 副本内；生产适配器、注册表和入口不会被测试改写。
const stripAdapterSource = `import { decodeFrame } from '../frame.js';
import { createTailProductParser } from './tail-parser.js';
import { streamPressureFields, streamInvalid } from './stream-utils.js';

const fixtureStripProfile = Object.freeze({
  product: 'fixtureStrip', label: '扩展条带', family: 'mat',
  baudRate: 115200, payloadLength: 2, sensorPoints: 2, rows: 1, cols: 2,
});
export const fixtureStripAdapter = Object.freeze({
  profile: fixtureStripProfile,
  aliases: Object.freeze(['strip']),
  optionFields: Object.freeze(['lane']),
  validateOptions(options, invalid) {
    if (!['A', 'B'].includes(options.lane)) invalid('lane', '请选择 A 或 B 通道组。');
  },
  connectionInfo: options => ({ lane: options.lane }),
  createParser(options) {
    return createTailProductParser({
      payloadLength: 2, delimiter: [0xde, 0xad],
      decodePayload(payload) {
        return { ...decodeFrame(payload, { rows: 1, cols: 2 }),
          product: 'fixtureStrip', pressure: payload, pressureMatrix: payload,
          lane: options.lane };
      },
    });
  },
  readStreamFields(input, output, typed) {
    streamPressureFields(input, output, typed);
    if (output.rows !== 1 || output.cols !== 2 || output.raw.length !== 2
      || !['A', 'B'].includes(input.lane)) streamInvalid('fixtureStrip.shape');
    output.lane = input.lane;
    return output;
  },
});
`;

class ExtensionPort extends EventEmitter {
  static instances = [];
  static async list() { return [{ path: 'EXTENSION_COM' }]; }
  constructor(options) {
    super(); this.options = options; this.isOpen = false; this.closeCalls = 0;
    ExtensionPort.instances.push(this);
  }
  open(callback) { queueMicrotask(() => { this.isOpen = true; callback(null); }); }
  close(callback) {
    this.closeCalls += 1; this.isOpen = false; this.emit('close'); callback(null);
  }
}

function nextFrame(stream) {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('扩展产品取数超时')); }, 3000);
    const unsubscribe = stream.onData(frame => { clearTimeout(timer); unsubscribe(); resolveFrame(frame); });
  });
}

test('one adapter plus one registry entry extends the unchanged five-function flow, WS codec, recordings and browser bundle', {
  skip: typeof nodeModule.registerHooks !== 'function' ? '串口依赖夹具需要 Node 22.15+' : false,
}, async t => {
  // 位于仓库下才能复用已安装的 ws；临时目录只包含本测试生成的 SDK 副本。
  const root = await mkdtemp(join(workspace, '.shroom-product-extension-'));
  const sdk = root;
  let device, server, stream;
  t.after(async () => {
    await stream?.close(); await server?.close(); await device?.close();
    assert.ok(resolve(root).startsWith(resolve(workspace) + sep));
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['core', 'node', 'web', 'flow', 'backend'].map(name => cp(join(sdkSource, name), join(sdk, name), { recursive: true })));
  await cp(join(sdkSource, 'quick-flow.js'), join(sdk, 'quick-flow.js'));
  await cp(join(sdkSource, 'package.json'), join(sdk, 'package.json'));
  await mkdir(join(root, 'scripts'));
  await cp(join(workspace, 'scripts', 'build-sdk-bundle.mjs'), join(root, 'scripts', 'build-sdk-bundle.mjs'));
  const registryPath = join(sdk, 'core', 'products', 'registry.js');
  const originalRegistry = await readFile(registryPath, 'utf8');
  assert.match(originalRegistry, /Object\.freeze\(\[gloveProductAdapter, padProductAdapter\]\)/);
  await writeFile(join(sdk, 'core', 'products', 'fixture-strip.js'), stripAdapterSource);
  await writeFile(registryPath,
    `import { fixtureStripAdapter } from './fixture-strip.js';\n` +
    originalRegistry.replace('Object.freeze([gloveProductAdapter, padProductAdapter])',
      'Object.freeze([gloveProductAdapter, padProductAdapter, fixtureStripAdapter])'));

  const stubKey = Symbol.for('shroom.extension.test.serialport');
  globalThis[stubKey] = ExtensionPort;
  const stubUrl = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.extension.test.serialport")];')}`;
  const sqliteUrl = import.meta.resolve('better-sqlite3');
  const hooks = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      // 临时源码副本不拷贝原生依赖；复用 SDK 已安装的真实 SQLite 驱动。
      if (specifier === 'better-sqlite3') return { url: sqliteUrl, shortCircuit: true };
      return specifier === 'serialport' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[stubKey]; });
  const license = await import(pathToFileURL(join(sdk, 'core', 'license.js')).href);
  await activateTestLicense({}, license);
  const api = await import(pathToFileURL(join(sdk, 'quick-flow.js')).href);
  assert.deepEqual(Object.keys(api).sort(), ['createWS', 'downloadRecording', 'readProduct', 'startRecording', 'stopRecording'].sort());
  await assert.rejects(api.readProduct({ product: 'strip', path: 'EXTENSION_COM', lane: 'bad' }), { code: 'INVALID_CONFIG' });
  assert.equal(ExtensionPort.instances.length, 0, '新产品自己的参数校验必须先于打开串口');
  const acquired = [], errors = [];
  device = await api.readProduct({ product: 'strip', path: 'EXTENSION_COM', lane: 'A',
    onData: frame => acquired.push(frame), onError: error => errors.push(error) });
  assert.equal(device.info.product, 'fixtureStrip');
  assert.equal(device.info.lane, 'A');
  const port = ExtensionPort.instances[0];
  assert.equal(port.options.baudRate, 115200);
  server = await api.createWS(device, { port: 0, recordingsDir: join(root, 'recordings') });
  stream = await api.readProduct({ url: server.url, onError: error => errors.push(error) });
  await api.startRecording(server, { label: '第三产品采集' });
  const received = nextFrame(stream);
  // 任意串口分块不应影响新产品的独立协议和自定义字段传输。
  port.emit('data', Uint8Array.of(20));
  port.emit('data', Uint8Array.of(200, 0xde, 0xad));
  const frame = await received;
  assert.equal(acquired.length, 1);
  assert.equal(frame.product, 'fixtureStrip');
  assert.equal(frame.lane, 'A');
  assert.deepEqual([...frame.pressureMatrix], [20, 200]);
  const recording = await api.stopRecording(server);
  assert.equal(recording.product, 'fixtureStrip');
  assert.equal(recording.frameCount, 1);
  const url = api.downloadRecording(server, { format: 'jsonl' });
  const row = JSON.parse((await fetch(url).then(response => response.text())).trim());
  assert.equal(row.frame.product, 'fixtureStrip');
  assert.equal(row.frame.lane, 'A');
  assert.deepEqual(row.frame.pressureMatrix, [20, 200]);
  const csv = await fetch(api.downloadRecording(server)).then(response => response.text());
  assert.ok(csv.includes('fixtureStrip'));
  assert.equal(errors.length, 0);

  // 构建脚本也保持原样，注册表新增的静态依赖必须自动进入经典浏览器脚本。
  await runFile(process.execPath, [join(root, 'scripts', 'build-sdk-bundle.mjs')], { cwd: root, timeout: 15000 });
  const bundle = await readFile(join(sdk, 'web', 'shroom.bundle.js'), 'utf8');
  const browser = { ...licenseBrowserGlobals };
  runInNewContext(bundle, browser);
  assert.ok(browser.Shroom.listDeviceProducts().some(product => product.product === 'fixtureStrip'));
  const bundledFrame = browser.Shroom.decodeStreamFrame(row.frame);
  assert.equal(bundledFrame.lane, 'A');
  assert.deepEqual(Array.from(bundledFrame.pressureMatrix), [20, 200]);
  assert.throws(() => browser.Shroom.decodeStreamFrame({ ...row.frame, lane: 'bad' }), { code: 'PARSE_FAILED' });
  assert.equal(await readFile(join(sdk, 'quick-flow.js'), 'utf8'), await readFile(join(sdkSource, 'quick-flow.js'), 'utf8'));
  assert.equal(await readFile(join(sdk, 'flow', 'runtime.js'), 'utf8'), await readFile(join(sdkSource, 'flow', 'runtime.js'), 'utf8'));
  await stream.close();
  await server.close();
  assert.equal(device.state, 'closed');
  assert.equal(port.closeCalls, 1);
});
