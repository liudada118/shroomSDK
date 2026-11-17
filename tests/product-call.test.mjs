import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductCall, productCallDataFields } from '../examples/product-call.js';
import * as NodeSdk from '../src/node/index.js';
import * as WebSdk from '../src/web/index.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('quick calls use an existing product function and deliver its data without protocol or UI setup', async () => {
  for (const product of ['glove', 'pad']) for (const side of ['left', 'right'])
    for (const env of ['web', 'node']) for (const platform of ['windows', 'macos', 'linux'])
      for (const importStyle of ['relative', 'package']) {
      const source = createProductCall({ product, side, env, platform, importStyle });
      const entry = importStyle === 'package' ? `shroom-sdk/${env}` : `./${env}/index.js`;
      assert.ok(source.includes(`from '${entry}'`));
      const name = product === 'glove' ? 'connectGlove' : 'connectHandPad';
      assert.equal(typeof (env === 'node' ? NodeSdk : WebSdk)[name], 'function');
      assert.match(source, /SDK 授权完成后/);
      assert.doesNotMatch(source, /<!doctype|connectProduct|baudRate|createFramer|activateLicense/i);
      if (env === 'web') assert.match(source, /点击事件/);
      const data = { fingers: {}, palm: {}, imu: {}, pressureMatrix: new Uint8Array(1024), values: new Float32Array(1024) };
      const device = { close: async () => {} }, calls = [], output = [];
      const run = new AsyncFunction(name, 'console', `${source.replace(/^import[^\n]+\n/, '')}\nreturn device;`);
      const actual = await run(async options => {
        calls.push(options);
        options.onData(data);
        return device;
      }, { log: (...args) => output.push(args), error() {} });
      assert.equal(actual, device);
      assert.equal(calls.length, 1, 'one product function opens the data subscription');
      assert.equal(calls[0].side, product === 'glove' ? side : undefined);
      assert.equal(calls[0].path === undefined, env === 'web');
      assert.deepEqual(output, [product === 'glove' ? [data.fingers, data.palm, data.imu] : [data.pressureMatrix, data.values]]);
    }
});

test('product call generation rejects unsupported choices instead of inventing an SDK API', () => {
  const base = { product: 'glove', side: 'left', env: 'web', platform: 'windows' };
  for (const override of [{ product: 'unknown' }, { side: 'auto' }, { env: 'python' }, { platform: 'unknown' }, { importStyle: 'url' }]) {
    assert.throws(() => createProductCall({ ...base, ...override }), TypeError);
  }
});

test('body and both insole protocols use Node calls and read their own fields without glove assumptions', async () => {
  const configurations = [
    { product: 'body' },
    ...['left', 'right'].flatMap(side => [undefined, '12bit', '8bit'].map(protocol => ({ product: 'insole', side, ...(protocol ? { protocol } : {}) }))),
  ];
  const data = { regions: { torso: { raw: [1] } }, raw: new Uint8Array(1024),
    sensors: { raw: new Uint16Array(112) }, pressure: new Uint16Array(256), imu: { quaternion: [1, 0, 0, 0] } };
  for (const configuration of configurations) for (const quickFlow of [false, true])
    for (const importStyle of ['relative', 'package']) {
      const source = createProductCall({ ...configuration, env: 'node', platform: 'linux', quickFlow, importStyle });
      const name = quickFlow ? 'readProduct' : 'connectProduct';
      assert.equal(typeof NodeSdk.connectProduct, 'function');
      assert.match(source, /0\.3\.0 或更高版本/);
      assert.match(source, /Node 服务端与网页请安装相同版本/);
      assert.doesNotMatch(source, /开发版|未发布/);
      assert.doesNotMatch(source, /fingers|palm|createProductView|<!doctype|baudRate/);
      const calls = [], output = [], device = { close: async () => {} };
      const run = new AsyncFunction(name, 'console', source.replace(/^import[^\n]+\n/, '') + '\nreturn device;');
      assert.equal(await run(async options => { calls.push(options); options.onData(data); return device; },
        { log: (...args) => output.push(args), error() {} }), device);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].product, configuration.product);
      assert.equal(calls[0].path, '/dev/ttyUSB0');
      assert.equal(calls[0].side, configuration.side);
      assert.equal(calls[0].protocol, configuration.product === 'insole' ? configuration.protocol ?? '12bit' : undefined);
      assert.deepEqual(output[0], configuration.product === 'body' ? [data.regions, data.raw] : [data.sensors, data.pressure, data.imu]);
    }
});

test('new products reject ambiguous protocol and side choices and do not generate direct browser examples', () => {
  const base = { product: 'insole', side: 'left', env: 'node', platform: 'windows' };
  for (const override of [{ side: undefined }, { side: 'auto' }, { protocol: 'auto' }, { protocol: null }, { env: 'web' }]) {
    assert.throws(() => createProductCall({ ...base, ...override }), TypeError);
  }
  assert.throws(() => createProductCall({ ...base, product: 'body', protocol: '12bit' }), /不使用/);
  assert.throws(() => createProductCall({ ...base, product: 'body', env: 'web' }), /Node.js/);
});

test('tactile-foot call snippets preserve raw field access for manual and automatic Node connections', async () => {
  assert.deepEqual(productCallDataFields('foot'), ['pressure', 'imu.raw', 'rawPackets']);
  const fields = productCallDataFields('foot');
  fields.push('fingers');
  assert.deepEqual(productCallDataFields('foot'), ['pressure', 'imu.raw', 'rawPackets']);
  const modes = [
    { side: 'left' }, { side: 'right' },
    { side: 'left', connectionMode: 'manual' }, { side: 'right', connectionMode: 'manual' },
    {}, { side: 'auto' }, { connectionMode: 'auto' },
    { side: 'left', connectionMode: 'auto' }, { side: 'right', connectionMode: 'auto' },
  ];
  const data = { pressure: Uint8Array.from([0, 1, 255]), imu: { raw: Uint8Array.from([255, 0]) },
    rawPackets: [Uint8Array.from([1, 3]), Uint8Array.from([2, 3])] };
  for (const configuration of modes) for (const platform of ['windows', 'macos', 'linux'])
    for (const importStyle of ['relative', 'package']) for (const quickFlow of [false, true]) {
      const source = createProductCall({ product: 'foot', ...configuration, env: 'node', platform, importStyle, quickFlow });
      const name = quickFlow ? 'readProduct' : 'connectTactileFoot';
      assert.equal(typeof NodeSdk.connectTactileFoot, 'function');
      const entry = importStyle === 'package' ? `shroom-sdk/${quickFlow ? 'quick-flow' : 'node'}`
        : quickFlow ? './quick-flow.js' : './node/index.js';
      assert.ok(source.includes(`from '${entry}'`));
      assert.match(source, /0\.7\.0 或更高版本/);
      assert.match(source, /3=左脚、4=右脚/);
      assert.doesNotMatch(source, /fingers|palm|sensors|createProductView|createFramer|baudRate|protocol:/);
      const calls = [], output = [], device = { close: async () => {} };
      const run = new AsyncFunction(name, 'console', source.replace(/^import[^\n]+\n/, '') + '\nreturn device;');
      const actual = await run(async options => { calls.push(options); options.onData(data); return device; },
        { log: (...args) => output.push(args), error() {} });
      assert.equal(actual, device);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].product, quickFlow ? 'foot' : undefined);
      const automatic = configuration.connectionMode === 'auto' || configuration.side === 'auto' || configuration.side === undefined;
      const expectedPath = platform === 'windows' ? 'COM3' : platform === 'macos' ? '/dev/cu.usbserial-实际端口' : '/dev/ttyUSB0';
      assert.equal(calls[0].path, automatic ? undefined : expectedPath);
      assert.equal(calls[0].side, configuration.side ?? 'auto');
      assert.deepEqual(output, [[data.pressure, data.imu.raw, data.rawPackets]]);
    }
});

test('explicit automatic mode supports a glove-side filter without changing existing manual defaults', async () => {
  const source = createProductCall({ product: 'glove', side: 'left', env: 'node', connectionMode: 'auto' });
  const calls = [];
  const run = new AsyncFunction('connectGlove', 'console', source.replace(/^import[^\n]+\n/, ''));
  await run(async options => { calls.push(options); return {}; }, { log() {}, error() {} });
  assert.equal(calls[0].side, 'left');
  assert.equal(calls[0].path, undefined);
  assert.throws(() => createProductCall({ product: 'glove', env: 'node' }), TypeError);
  assert.match(createProductCall({ product: 'glove', side: 'left', env: 'node' }), /path: 'COM3'/);
});

test('foot snippets reject unsupported protocols, direct browser generation and invalid discovery options', () => {
  const base = { product: 'foot', side: 'left', env: 'node' };
  for (const override of [{ protocol: '12bit' }, { protocol: '8bit' }, { protocol: null }, { env: 'web' },
    { side: 'both' }, { side: null }, { connectionMode: 'unknown' }, { side: 'auto', connectionMode: 'manual' },
    { side: undefined, connectionMode: 'manual' }, { product: 'pad', connectionMode: 'auto' },
    { product: 'insole', connectionMode: 'auto' }, { product: 'glove', env: 'web', connectionMode: 'auto' }]) {
    assert.throws(() => createProductCall({ ...base, ...override }), TypeError);
  }
});
