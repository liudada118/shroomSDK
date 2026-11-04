import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductCall } from '../examples/product-call.js';
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
      assert.match(source, /0\.3\.0 开发版/);
      assert.match(source, /npm 0\.2\.0 不包含/);
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
