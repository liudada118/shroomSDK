import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import * as nodeModule from 'node:module';
import { activateTestLicense } from './license-fixture.mjs';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from '../src/quick-flow.js';

// 来自协议规格的合成帧：不连接实物，不将这些帧称为真机抓包。
const magic = [0xaa, 0x55, 0x03, 0x99];
function insoleWire(protocol) {
  const adc = protocol === '12bit'
    ? Uint16Array.from({ length: 256 }, (_, i) => i * 16 + 15)
    : Uint8Array.from({ length: 256 }, (_, i) => i);
  const bytes = new Uint8Array(protocol === '12bit' ? 552 : 272);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 256; i++) {
    if (protocol === '12bit') view.setUint16(i * 2, adc[i], true);
    else bytes[i] = adc[i];
  }
  const imuOffset = protocol === '12bit' ? 512 : 256;
  const imu = protocol === '12bit' ? [1, -0.25, 0.5, 0, -2, 3, -4, 5, -6, 7] : [1, -0.25, 0.5, 0];
  imu.forEach((value, i) => view.setFloat32(imuOffset + i * 4, value, true));
  return { adc, wire: protocol === '12bit' ? Uint8Array.from([...magic, ...bytes])
    : Uint8Array.from([...magic, 1, 31, ...bytes.subarray(0, 128), ...magic, 2, 31, ...bytes.subarray(128)]) };
}

class NewProductPort extends EventEmitter {
  static instances = [];
  static async list() { return [{ path: 'PRODUCT_FIXTURE' }]; }
  constructor(options) { super(); this.options = options; this.isOpen = false; NewProductPort.instances.push(this); }
  open(callback) { queueMicrotask(() => { this.isOpen = true; callback(null); }); }
  close(callback) { this.isOpen = false; this.emit('close'); callback(null); }
}

function oneFrame(stream) {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('新产品 WS 帧超时')); }, 3000);
    const off = stream.onData(frame => { clearTimeout(timer); off(); resolveFrame(frame); });
  });
}

test('new products retain channel precision and mappings through all five functions, SQLite and HTTP exports', {
  skip: typeof nodeModule.registerHooks !== 'function' ? '串口替身需要Node22.15+' : false,
}, async t => {
  await activateTestLicense();
  // 仅替代浏览器下载链接的 DOM，下载内容仍通过真实HTTP读取验证。
  const previousDocument = globalThis.document;
  const clickedDownloads = [];
  globalThis.document = {
    body: { appendChild() {} },
    createElement() { return { click() { clickedDownloads.push(this.href); }, remove() {} }; },
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const serialKey = Symbol.for('shroom.new-products.serialport');
  globalThis[serialKey] = NewProductPort;
  const stub = `data:text/javascript,${encodeURIComponent('export const SerialPort = globalThis[Symbol.for("shroom.new-products.serialport")];')}`;
  const hooks = nodeModule.registerHooks({ resolve(specifier, context, next) {
    return specifier === 'serialport' ? { url: stub, shortCircuit: true } : next(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[serialKey]; });
  const cases = [
    { product: 'body' },
    { product: 'insole', side: 'left', protocol: '12bit', baudRate: 1500000 },
    { product: 'insole', side: 'right', protocol: '8bit' },
  ];
  for (const config of cases) {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, 'shroom-new-products-'));
    let device, server, stream;
    try {
      const errors = [];
      device = await readProduct({ ...config, path: 'PRODUCT_FIXTURE', onError: error => errors.push(error) });
      const port = NewProductPort.instances.at(-1);
      assert.equal(port.options.baudRate, config.baudRate ?? (config.product === 'body' ? 1000000 : 921600));
      server = await createWS(device, { port: 0, recordingsDir: directory });
      stream = await readProduct({ url: server.url, onError: error => errors.push(error) });
      const started = await startRecording(stream, { label: `协议验证-${config.product}-${config.protocol ?? ''}` });
      const bodyAdc = Uint8Array.from({ length: 1024 }, (_, i) => (i * 19 + 7) % 256);
      const fixture = config.product === 'body'
        ? { adc: bodyAdc, wire: Uint8Array.from([...bodyAdc, ...magic]) }
        : insoleWire(config.protocol);
      const received = oneFrame(stream);
      // 任意读取边界：包括魔术头与两字节 ADC 被拆分。
      for (let i = 0; i < fixture.wire.length; i += 13) port.emit('data', fixture.wire.subarray(i, i + 13));
      const frame = await received;
      assert.deepEqual([...frame.pressure], [...fixture.adc]);
      if (config.product === 'body') {
        assert.equal(frame.product, 'humanBody');
        assert.equal(Object.keys(frame.regions).length, 10);
        assert.equal(frame.regions.back.sourceIndices[0], 618);
        assert.equal(frame.regions.back.raw[0], bodyAdc[618]);
      } else {
        assert.equal(frame.product, 'jqInsole');
        assert.equal(frame.protocol, config.protocol);
        assert.equal(frame.side, config.side);
        assert.equal(frame.pressure.at(-1), config.protocol === '12bit' ? 4095 : 255);
        assert.ok(frame.pressure instanceof (config.protocol === '12bit' ? Uint16Array : Uint8Array));
        assert.equal(frame.imu.quaternion[1], -0.25);
        assert.equal(frame.sensors.sourceIndices[0], config.side === 'left' ? 141 : 114);
        assert.equal(frame.sensors.raw.length, 112);
        if (config.protocol === '12bit') assert.equal(frame.imu.gyroscope[0], -2);
        else assert.equal(frame.imu.gyroscope, undefined);
      }
      const stopped = await stopRecording(stream);
      assert.equal(stopped.id, started.id);
      assert.equal(stopped.frameCount, 1);
      assert.equal(stopped.status, 'stopped');
      const jsonUrl = downloadRecording(stream, { format: 'jsonl' });
      assert.equal(clickedDownloads.at(-1), jsonUrl);
      const exported = JSON.parse((await fetch(jsonUrl).then(r => r.text())).trim());
      assert.deepEqual(exported.frame.pressure, [...fixture.adc]);
      if (config.product === 'body') assert.deepEqual(exported.frame.regions.back.sourceIndices, [...frame.regions.back.sourceIndices]);
      else {
        assert.deepEqual(exported.frame.sensors.positions, frame.sensors.positions);
        assert.deepEqual(exported.frame.imu.quaternion, [...frame.imu.quaternion]);
      }
      const csv = await fetch(downloadRecording(stream)).then(r => r.text());
      assert.ok(csv.includes(config.product === 'body' ? '""regions""' : '""sensors""'));
      assert.deepEqual(errors, []);
    } finally {
      await stream?.close(); await server?.close(); await device?.close();
      assert.equal(dirname(resolve(directory)), temporaryRoot);
      await rm(directory, { recursive: true, force: true });
    }
  }
});
