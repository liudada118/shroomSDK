import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductCall } from '../examples/product-call.js';
import * as NodeSdk from '../node/index.js';
import * as WebSdk from '../web/index.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('quick calls use an existing product function and deliver its data without protocol or UI setup', async () => {
  for (const product of ['glove', 'pad']) for (const side of ['left', 'right'])
    for (const env of ['web', 'node']) for (const platform of ['windows', 'macos', 'linux']) {
      const source = createProductCall({ product, side, env, platform });
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
  for (const override of [{ product: 'unknown' }, { side: 'auto' }, { env: 'python' }, { platform: 'unknown' }]) {
    assert.throws(() => createProductCall({ ...base, ...override }), TypeError);
  }
});
