import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import test from 'node:test';

import { createProductExample, getProductExampleFilename } from '../examples/product-examples.js';

const create = createProductExample;
const configuration = { product: 'glove', side: 'left', env: 'web', platform: 'windows' };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function storage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function device() {
  return {
    state: 'open', closed: 0,
    getDiagnostics: () => ({ source: 'web-serial', state: 'open', status: 'streaming', bytesReceived: 400, frameCount: 1, droppedCount: 0, frameLength: 274, key: 'DO_NOT_COPY', details: { key: 'DO_NOT_COPY' } }),
    async close() { this.closed += 1; this.state = 'closed'; },
  };
}

function frame() {
  const palm = Array.from({ length: 5 }, (_, row) => Array.from({ length: row === 0 ? 12 : 15 }, (_, column) => row * 15 + column));
  return {
    product: 'handGloveFullPacket', side: 'left', pressure: Uint8Array.of(1, 2), pressureMatrix: Uint8Array.of(2, 1),
    fingers: Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'little'].map((name, index) => [name, { raw: Uint8Array.of(index + 12), pulp: { raw: Uint8Array.of(index + 22) } }])),
    palm: { matrix: palm },
  };
}

function padFrame() {
  const matrix = new Uint8Array(1024);
  matrix[0] = 255;
  matrix[31 * 32 + 30] = 27; // A new touch weaker than an unrelated existing peak must still be visible.
  return { product: 'hand', pressure: matrix, pressureMatrix: matrix };
}

function browserHarness({ persisted = storage(), connect, activate, clipboard = true, options = configuration } = {}) {
  const elements = new Map();
  const events = new Map();
  const calls = { activation: [], connection: [], clipboard: [] };
  let status = { valid: false, code: 'LICENSE_REQUIRED' };
  let licenseRevision = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, textContent: '', value: id === 'license-mode' ? 'online' : '', disabled: ['connect', 'disconnect'].includes(id), hidden: id === 'diagnostics' });
    return elements.get(id);
  };
  const sdk = {
    version: '0.1.0',
    getLicenseStatus: () => status,
    async activateLicense(key, options) {
      const revision = ++licenseRevision;
      calls.activation.push({ key, options });
      if (activate) await activate(key, options);
      if (revision !== licenseRevision) throw { code: 'LICENSE_REJECTED', message: 'Activation cancelled by clearLicense' };
      status = { valid: true, mode: options.mode, expiresAt: 123456789 };
      return status;
    },
    clearLicense() { licenseRevision += 1; status = { valid: false, code: 'LICENSE_REQUIRED' }; },
    connectProduct(options) {
      calls.connection.push(options);
      return connect ? connect(options, calls.connection.length) : Promise.resolve(device());
    },
  };
  const source = create(options).match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\s*$/m, '');
  const context = vm.createContext({
    Shroom: sdk, document: { getElementById: element },
    window: { addEventListener: (event, callback, options) => events.set(event, (...args) => {
      if (options?.once) events.delete(event);
      return callback(...args);
    }) },
    localStorage: persisted, crypto: webcrypto, Uint8Array,
    navigator: clipboard ? { clipboard: { writeText: async (text) => { calls.clipboard.push(text); } } } : {},
    setTimeout: () => 1, clearTimeout() {}, console,
  });
  vm.runInContext(source, context);
  return {
    element, events, calls, sdk, persisted,
    expire() { status = { valid: false, code: 'LICENSE_EXPIRED' }; },
    async activate(key = 'TEST_LICENSE_DO_NOT_PERSIST') { element('key').value = key; await element('activate').onclick(); },
  };
}

test('generator validates explicit glove side and supports every OS/runtime/product combination', () => {
  assert.throws(() => create({ ...configuration, side: undefined }), /左右手/);
  assert.throws(() => create({ ...configuration, env: 'python' }), /JavaScript/);
  for (const product of ['glove', 'pad']) for (const side of ['left', 'right']) for (const env of ['web', 'node']) for (const platform of ['windows', 'macos', 'linux']) for (const kind of ['complete', 'snippet']) {
    const source = create({ product, side, env, platform, kind });
    const javascript = env === 'web' && kind === 'complete'
      ? source.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      : source;
    const parsed = javascript.replace(/^import .*;\s*$/gm, '').replace(/^await \(/m, '(').replace(/const device = await Shroom.connectProduct/g, 'const device = Shroom.connectProduct');
    assert.doesNotThrow(() => new vm.Script(parsed), [product, side, env, platform, kind].join('/'));
    assert.match(source, product === 'glove' ? /handGloveFullPacket/ : /product.*hand/);
    if (product === 'pad' && kind === 'snippet') assert.doesNotMatch(source, /side:/);
    if (kind === 'complete' && env === 'node') {
      assert.match(source, /license-env\.js/);
      assert.match(source, /process\.argv\[2\]/);
      assert.doesNotMatch(source, /SHROOM_DEVICE_ID =|path: 'COM3'/);
    }
  }
});

test('formal example module imports in Node and exposes only pure ESM factories without browser globals', async () => {
  assert.equal(Object.hasOwn(globalThis, 'WorkspaceExamples'), false);
  const module = await import('../examples/product-examples.js?purity-check');
  assert.deepEqual(Object.keys(module).sort(), ['createProductExample', 'getProductExampleFilename']);
  assert.equal(Object.hasOwn(globalThis, 'WorkspaceExamples'), false);
  assert.equal(Object.hasOwn(globalThis, 'Shroom'), false);
  assert.equal(typeof module.createProductExample(configuration), 'string');
  assert.equal(Object.hasOwn(globalThis, 'WorkspaceExamples'), false);
  assert.equal(Object.hasOwn(globalThis, 'Shroom'), false);
});

test('production minification preserves every generated byte including explanatory Chinese comments', async () => {
  // 独立 SDK 锁定自己的压缩器依赖，不能靠官网安装结果或跳过校验。
  const { transform } = await import('esbuild');
  const source = await readFile(new URL('../examples/product-examples.js', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'js', format: 'cjs', target: 'es2022', minify: true, legalComments: 'none' });
  const compiled = { exports: {} };
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports });
  for (const product of ['glove', 'pad']) for (const side of ['left', 'right']) for (const env of ['web', 'node']) for (const platform of ['windows', 'macos', 'linux']) for (const kind of ['complete', 'snippet']) {
    const options = { product, side, env, platform, kind };
    assert.equal(compiled.exports.createProductExample(options), createProductExample(options));
    assert.equal(compiled.exports.getProductExampleFilename(options), getProductExampleFilename(options));
  }
});

test('filename factory and content factory share product and glove-side validation', () => {
  assert.equal(getProductExampleFilename(configuration), 'glove-left-example.html');
  assert.equal(getProductExampleFilename({ ...configuration, side: 'right', env: 'node' }), 'glove-right-example.mjs');
  assert.equal(getProductExampleFilename({ product: 'pad', env: 'web', platform: 'linux' }), 'hand-pad-example.html');
  for (const factory of [createProductExample, getProductExampleFilename]) {
    assert.throws(() => factory({ ...configuration, side: undefined }), /左右手/);
    assert.throws(() => factory({ ...configuration, platform: 'unknown' }), /Windows/);
    assert.throws(() => factory({ ...configuration, env: 'python' }), /JavaScript/);
  }
});

test('six SDK-root examples exactly match the source factory and import existing SDK-root entries', async () => {
  for (const productOptions of [{ product: 'glove', side: 'left' }, { product: 'glove', side: 'right' }, { product: 'pad' }]) {
    for (const env of ['web', 'node']) {
      const options = { ...productOptions, env, platform: 'windows', kind: 'complete' };
      const filename = getProductExampleFilename(options);
      const path = new URL('../' + filename, import.meta.url);
      const source = await readFile(path, 'utf8');
      assert.equal(source, createProductExample(options), filename + ' must be regenerated from the factory');
      const imports = [...source.matchAll(/^import\s.+?\sfrom ['"]([^'"]+)['"];$/gm)].map((match) => match[1]);
      assert.deepEqual(imports, env === 'web' ? ['./web/index.js'] : ['./node/index.js', './node/license-env.js']);
      for (const relativePath of imports) await access(new URL(relativePath, path));
      if (env === 'web') await access(new URL('../start.mjs', import.meta.url));
      assert.match(source, /Windows[^\n]*产品接入页面[^\n]*重新生成/);
    }
  }
});

test('complete browser example includes both drivers, separate activation, first-frame verification and accessible errors', () => {
  const html = create(configuration);
  assert.match(html, /https:\/\/shroom\.jq-industries\.com\/drive\/CH341SER\.EXE/);
  assert.match(html, /https:\/\/shroom\.jq-industries\.com\/drive\/CH34xVCPDriver\.zip/);
  assert.match(html, /node start\.mjs/);
  assert.match(html, /role="alert"/);
  assert.match(html, /id="copy-diagnostics"/);
  assert.doesNotMatch(html, /<input[^>]*installation|publicKey:/);
});

test('every downloaded example and integration snippet explains the SDK contract beside the relevant code in Chinese', () => {
  for (const product of ['glove', 'pad']) for (const side of ['left', 'right']) for (const env of ['web', 'node']) for (const platform of ['windows', 'macos', 'linux']) for (const kind of ['complete', 'snippet']) {
    const source = create({ product, side, env, platform, kind });
    const javascript = env === 'web' && kind === 'complete'
      ? source.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      : source;
    const comments = (javascript.match(/(?:^|\n)\s*\/\/[^\n]*/g) || []).join('\n');
    const description = [product, side, env, platform, kind].join('/');
    for (const requirement of [/导入/, /product|产品协议/, /安装标识/, /onData/, /onError/, /ADC/, /Pa\/N/, /close\(\)/, /CALLBACK_FAILED/, /不自动重连|手动重新连接|用户决定是否重连/]) {
      assert.match(comments, requirement, description);
    }
    assert.match(comments, product === 'glove' ? /pulp\.raw/ : /32×32/, description);
    assert.match(source, /用途/, description);
    assert.doesNotMatch(source, /工作区原型|生成器内部|WorkspaceExamples|serialized|prototype/i, description);
  }
});

test('complete browser comments explain asynchronous ownership, field meanings, privacy and repeatable page lifecycle', () => {
  const source = create(configuration);
  for (const requirement of [
    /<!-- 准备区[\s\S]*<!-- 授权区[\s\S]*<!-- 采集与验收区[\s\S]*<!-- 模块区/,
    /\/\/ 一、连接状态/, /\/\/ 二、错误与界面/, /\/\/ 三、关闭与竞态/,
    /\/\/ 四、onData 数据/, /\/\/ 五、稳定安装标识/, /\/\/ 六、独立激活/,
    /\/\/ 七、连接设备/, /\/\/ 八、支持诊断/, /\/\/ 九、页面生命周期/,
    /首行 12 点，其余四行各 15 点/, /不复制密钥、安装标识/,
    /旧请求不能清空用户刚输入的新密钥/, /迟到的设备不能成为新会话/,
    /从往返缓存恢复时重置界面/, /前面不能先 await 远程激活/,
  ]) assert.match(source, requirement);
});

test('installation identity persists automatically while license text is cleared and never persisted', async () => {
  const persisted = storage();
  const first = browserHarness({ persisted });
  await first.activate();
  assert.match(first.calls.activation[0].options.deviceId, /^[a-f0-9]{64}$/);
  assert.equal(first.element('key').value, '');
  assert.equal(persisted.values.size, 1);
  assert.ok(![...persisted.values.values()].includes('TEST_LICENSE_DO_NOT_PERSIST'));
  const second = browserHarness({ persisted });
  second.element('license-mode').value = 'offline';
  await second.activate();
  assert.equal(first.calls.activation[0].options.deviceId, second.calls.activation[0].options.deviceId);
  assert.equal(second.calls.activation[0].options.mode, 'offline');
  assert.equal(second.calls.activation[0].options.publicKey, undefined);
});

test('blocked storage blocks activation with recovery instructions instead of generating a new allowance each load', async () => {
  const harness = browserHarness({ persisted: { getItem() { throw new Error('blocked'); }, setItem() {} } });
  assert.equal(harness.element('activate').disabled, true);
  assert.match(harness.element('last-error').textContent, /允许当前站点存储/);
  await harness.activate();
  assert.equal(harness.calls.activation.length, 0);
});

test('browser reports connection/first-frame states and reconnects after a runtime unplug', async () => {
  const opening = deferred();
  const firstDevice = device();
  const harness = browserHarness({ connect: (_options, count) => count === 1 ? opening.promise : Promise.resolve(device()) });
  await harness.activate();
  const connecting = harness.element('connect').onclick();
  assert.equal(harness.element('connection-state').textContent, '连接中');
  assert.equal(harness.calls.connection.length, 1, 'connectProduct invoked synchronously in the click');
  opening.resolve(firstDevice);
  await connecting;
  assert.equal(harness.element('connection-state').textContent, '等待首帧');
  harness.calls.connection[0].onData(frame());
  assert.equal(harness.element('connection-state').textContent, '正在取数');
  assert.equal(harness.element('frame-count').textContent, '1');
  harness.calls.connection[0].onError({ code: 'CALLBACK_FAILED', message: 'Customer callback failed' });
  await settle();
  assert.equal(firstDevice.closed, 0);
  assert.equal(harness.element('connection-state').textContent, '正在取数');
  harness.calls.connection[0].onError({ code: 'DISCONNECTED', message: 'Unplugged' });
  await settle();
  assert.equal(firstDevice.closed, 1);
  assert.equal(harness.element('connection-state').textContent, '已断开');
  assert.equal(harness.element('connect').disabled, false);
  await harness.element('connect').onclick();
  assert.equal(harness.calls.connection.length, 2);
  assert.equal(harness.element('connection-state').textContent, '等待首帧');
});

test('browser shows every finger, pulp and all 72 palm points, including the final palm row', async () => {
  const harness = browserHarness();
  await harness.activate();
  await harness.element('connect').onclick();
  const sample = frame();
  harness.calls.connection[0].onData(sample);
  const displayed = JSON.parse(harness.element('data').textContent);
  assert.deepEqual(Object.keys(displayed.fingersADC), ['thumb', 'index', 'middle', 'ring', 'little']);
  assert.deepEqual(displayed.fingersADC.little, { body: [16], pulp: [26] });
  assert.deepEqual(displayed.palmADC, sample.palm.matrix);
  assert.equal(displayed.palmADC.flat().length, 72);
  assert.equal(displayed.palmADC[4][14], 74);
});

test('browser pad sample exposes all 1024 mapped points even when a touch does not replace the peak', async () => {
  const harness = browserHarness({ options: { ...configuration, product: 'pad' } });
  await harness.activate();
  await harness.element('connect').onclick();
  harness.calls.connection[0].onData(padFrame());
  const displayed = JSON.parse(harness.element('data').textContent);
  assert.deepEqual(displayed.peakMatrixPoint, { row: 0, column: 0, adc: 255 });
  assert.equal(displayed.pressureMatrixADC.length, 32);
  assert.ok(displayed.pressureMatrixADC.every((row) => row.length === 32));
  assert.equal(displayed.pressureMatrixADC[31][30], 27);
  assert.equal(displayed.pressureMatrixADC.flat().length, 1024);
  assert.ok(harness.element('data').textContent.split('\n').length < 100, 'readable compact rows rather than one line per ADC point');
});

test('license expiry stops capture and reactivation permits a fresh device without stale references', async () => {
  const firstDevice = device();
  const harness = browserHarness({ connect: (_options, count) => Promise.resolve(count === 1 ? firstDevice : device()) });
  await harness.activate();
  await harness.element('connect').onclick();
  harness.expire();
  harness.calls.connection[0].onError({ code: 'LICENSE_EXPIRED', message: 'Expired' });
  await settle();
  assert.equal(firstDevice.closed, 1);
  assert.equal(harness.element('connect').disabled, true);
  await harness.activate('NEW_TEST_LICENSE');
  assert.equal(harness.element('connect').disabled, false);
  await harness.element('connect').onclick();
  assert.equal(harness.calls.connection.length, 2);
});

test('activation closes the existing device before replacing the license and suppresses stale frames', async () => {
  const closing = deferred();
  const firstDevice = device();
  firstDevice.close = async () => { firstDevice.closed += 1; await closing.promise; firstDevice.state = 'closed'; };
  const harness = browserHarness({ connect: () => Promise.resolve(firstDevice) });
  await harness.activate();
  await harness.element('connect').onclick();
  const activating = harness.activate('REPLACEMENT_TEST_LICENSE');
  await settle();
  assert.equal(firstDevice.closed, 1);
  assert.equal(harness.calls.activation.length, 1, 'replacement waits for close');
  assert.equal(harness.element('connect').disabled, true);
  harness.calls.connection[0].onData(frame());
  assert.equal(harness.element('frame-count').textContent, '0');
  closing.resolve();
  await activating;
  assert.equal(harness.calls.activation.length, 2);
  assert.equal(harness.element('connect').disabled, false);
});

test('runtime failure before open resolves closes the returned device and allows retry', async () => {
  const opening = deferred();
  const lateDevice = device();
  const harness = browserHarness({ connect: (options) => {
    options.onError({ code: 'READ_FAILED', message: 'Read failed while opening' });
    return opening.promise;
  } });
  await harness.activate();
  const connecting = harness.element('connect').onclick();
  assert.equal(harness.element('connection-state').textContent, '已断开');
  opening.resolve(lateDevice);
  await connecting;
  assert.equal(lateDevice.closed, 1);
  assert.equal(harness.element('connect').disabled, false);
});

test('reactivation during a pending chooser retires its late device and cannot enable overlapping connects', async () => {
  const opening = deferred();
  const lateDevice = device();
  const harness = browserHarness({ connect: () => opening.promise });
  await harness.activate();
  const connecting = harness.element('connect').onclick();
  await harness.activate('NEW_TEST_LICENSE');
  assert.equal(harness.element('connect').disabled, true);
  opening.resolve(lateDevice);
  await connecting;
  assert.equal(lateDevice.closed, 1);
  assert.equal(harness.element('connect').disabled, false);
});

test('manual disconnect awaits close and restores controls even if close reports an error', async () => {
  const badClose = device();
  badClose.close = async () => { badClose.closed += 1; throw { code: 'CLOSE_FAILED', message: 'Port close failed' }; };
  const harness = browserHarness({ connect: () => Promise.resolve(badClose) });
  await harness.activate();
  await harness.element('connect').onclick();
  await harness.element('disconnect').onclick();
  assert.equal(badClose.closed, 1);
  assert.equal(harness.element('connect').disabled, false);
  assert.match(harness.element('last-error').textContent, /CLOSE_FAILED/);
});

test('diagnostics whitelist fields without key, installation ID or SDK request details', async () => {
  const harness = browserHarness();
  await harness.activate();
  await harness.element('connect').onclick();
  await harness.element('copy-diagnostics').onclick();
  const diagnostic = harness.calls.clipboard[0];
  assert.equal(JSON.parse(diagnostic).product, 'handGloveFullPacket');
  assert.doesNotMatch(diagnostic, /TEST_LICENSE|DO_NOT_COPY|deviceId|installation/);
  assert.ok(!diagnostic.includes(harness.calls.activation[0].options.deviceId));
  const blocked = browserHarness({ clipboard: false });
  await blocked.element('copy-diagnostics').onclick();
  assert.equal(blocked.element('diagnostics').hidden, false);
  assert.equal(JSON.parse(blocked.element('diagnostics').textContent).runtime, 'web');
});

test('pagehide clears authorization and closes a late connection instead of leaving a live device', async () => {
  const opening = deferred();
  const lateDevice = device();
  const harness = browserHarness({ connect: () => opening.promise });
  await harness.activate();
  const connecting = harness.element('connect').onclick();
  harness.events.get('pagehide')();
  opening.resolve(lateDevice);
  await connecting;
  assert.equal(lateDevice.closed, 1);
  assert.equal(harness.sdk.getLicenseStatus().valid, false);
});

test('BFCache pageshow restores safe controls and repeated navigation closes each new session', async () => {
  const sourceDevices = [device(), device()];
  const harness = browserHarness({ connect: (_options, count) => Promise.resolve(sourceDevices[count - 1]) });
  await harness.activate();
  await harness.element('connect').onclick();
  harness.calls.connection[0].onData(frame());
  harness.events.get('pagehide')({ persisted: true });
  await settle();
  assert.equal(sourceDevices[0].closed, 1);
  assert.ok(harness.events.has('pagehide'), 'pagehide must remain registered for the next navigation');
  harness.events.get('pageshow')({ persisted: true });
  assert.equal(harness.element('connection-state').textContent, '已断开');
  assert.equal(harness.element('frame-count').textContent, '0');
  assert.equal(harness.element('activate').disabled, false);
  assert.equal(harness.element('connect').disabled, true, 'must reactivate rather than reuse a stale license');
  assert.match(harness.element('next-step').textContent, /重新激活/);
  await harness.activate('REACTIVATED_AFTER_RESTORE');
  assert.equal(harness.element('connect').disabled, false);
  await harness.element('connect').onclick();
  assert.equal(harness.calls.connection.length, 2);
  harness.events.get('pagehide')({ persisted: true });
  await settle();
  assert.equal(sourceDevices[1].closed, 1);
  harness.events.get('pageshow')({ persisted: true });
  assert.equal(harness.element('activate').disabled, false);
  assert.equal(harness.element('connect').disabled, true);
});

test('BFCache recovery cancels pending activation without locking controls or clearing a new key draft', async () => {
  const activation = deferred();
  const harness = browserHarness({ activate: () => activation.promise });
  const activating = harness.activate('OLD_PENDING_LICENSE');
  await settle();
  assert.equal(harness.element('activate').disabled, true);
  harness.events.get('pagehide')({ persisted: true });
  harness.events.get('pageshow')({ persisted: true });
  assert.equal(harness.element('activate').disabled, false);
  harness.element('key').value = 'NEW_DRAFT_LICENSE';
  activation.resolve();
  await activating;
  assert.equal(harness.element('key').value, 'NEW_DRAFT_LICENSE');
  assert.equal(harness.element('activate').disabled, false);
  assert.equal(harness.element('connect').disabled, true);
  await harness.activate('NEW_ACTIVATION_LICENSE');
  assert.equal(harness.element('connect').disabled, false);
});

test('BFCache recovery retires a pending open and permits a fresh connection after it closes', async () => {
  const opening = deferred();
  const lateDevice = device();
  const harness = browserHarness({ connect: (_options, count) => count === 1 ? opening.promise : Promise.resolve(device()) });
  await harness.activate();
  const connecting = harness.element('connect').onclick();
  harness.events.get('pagehide')({ persisted: true });
  harness.events.get('pageshow')({ persisted: true });
  await harness.activate('NEW_LICENSE_AFTER_RETURN');
  assert.equal(harness.element('connect').disabled, true, 'wait for the old port chooser/open to settle');
  opening.resolve(lateDevice);
  await connecting;
  assert.equal(lateDevice.closed, 1);
  assert.equal(harness.element('connect').disabled, false);
  await harness.element('connect').onclick();
  assert.equal(harness.calls.connection.length, 2);
});

async function nodeHarness({ path = 'COM9', connect, options = configuration } = {}) {
  const processStub = new EventEmitter();
  processStub.argv = ['node', 'example.mjs', ...(path ? [path] : [])];
  const calls = { activation: 0, connection: [], logs: [], errors: [] };
  const source = create({ ...options, env: 'node' }).replace(/^import .*;\s*$/gm, '').replace(/^await \(/m, 'globalThis.examplePromise = (');
  const context = vm.createContext({
    process: processStub, console: { log: (text) => calls.logs.push(text), error: (text) => calls.errors.push(text) },
    Shroom: { connectProduct: async (options) => { calls.connection.push(options); return connect ? connect(options) : device(); } },
    activateLicenseFromEnv: async () => { calls.activation += 1; },
  });
  vm.runInContext(source, context);
  await context.examplePromise;
  return { processStub, calls };
}

test('Node complete example requires an actual port argument before activation', async () => {
  const harness = await nodeHarness({ path: '' });
  assert.equal(harness.processStub.exitCode, 1);
  assert.equal(harness.calls.activation, 0);
  assert.match(harness.calls.errors.join('\n'), /实际识别到的串口路径/);
});

test('Node example receives frames, tolerates callback failures and releases port on signal', async () => {
  const sourceDevice = device();
  const harness = await nodeHarness({ connect: () => sourceDevice });
  assert.equal(harness.calls.activation, 1);
  assert.equal(harness.calls.connection[0].path, 'COM9');
  harness.calls.connection[0].onData(frame());
  assert.match(harness.calls.logs.join('\n'), /已收到首帧/);
  harness.calls.connection[0].onError({ code: 'CALLBACK_FAILED', message: 'Callback failure' });
  await settle();
  assert.equal(sourceDevice.closed, 0);
  harness.processStub.emit('SIGINT');
  await settle();
  assert.equal(sourceDevice.closed, 1);
  assert.equal(harness.processStub.listenerCount('SIGTERM'), 0);
});

test('Node runtime authorization error closes capture and preserves a failure exit code', async () => {
  const sourceDevice = device();
  const harness = await nodeHarness({ connect: () => sourceDevice });
  harness.calls.connection[0].onError({ code: 'LICENSE_EXPIRED', message: 'Expired' });
  await settle();
  assert.equal(sourceDevice.closed, 1);
  assert.equal(harness.processStub.exitCode, 1);
});

test('Node glove example logs complete finger/pulp and palm data beyond the first row', async () => {
  const harness = await nodeHarness();
  harness.calls.connection[0].onData(frame());
  const displayed = JSON.parse(harness.calls.logs.find((line) => line.startsWith('{')));
  assert.equal(displayed.palmADC.flat().length, 72);
  assert.equal(displayed.palmADC[4][14], 74);
  assert.deepEqual(displayed.fingersADC.little, { body: [16], pulp: [26] });
  harness.processStub.emit('SIGINT');
  await settle();
});

test('Node pad example logs the full matrix including a weaker touch in its last row', async () => {
  const harness = await nodeHarness({ options: { ...configuration, product: 'pad' } });
  harness.calls.connection[0].onData(padFrame());
  const displayed = JSON.parse(harness.calls.logs.find((line) => line.startsWith('{')));
  assert.equal(displayed.pressureMatrixADC.flat().length, 1024);
  assert.equal(displayed.pressureMatrixADC[31][30], 27);
  harness.processStub.emit('SIGINT');
  await settle();
});
