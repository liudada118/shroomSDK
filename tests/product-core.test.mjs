import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createProductParser, prepareProductConnection, listDeviceProducts } from '../core/product.js';
import { createTailProductParser } from '../core/products/tail-parser.js';
import { decodeFrame } from '../core/frame.js';
import { Shroom as NodeShroom } from '../node/index.js';
import { Shroom as WebShroom } from '../web/index.js';
import { activateTestLicense, licenseBrowserGlobals } from './license-fixture.mjs';

const tail = [0xaa, 0x55, 0x03, 0x99];
const wire = (payload) => Uint8Array.from([...payload, ...tail]);

test('shared product parser rejects empty boundaries and isolates delimiter configuration', () => {
  const options = { payloadLength: 2, delimiter: [255], decodePayload: bytes => bytes };
  for (const override of [{ delimiter: [] }, { delimiter: [256] }, { payloadLength: 0 }, { decodePayload: null }]) {
    assert.throws(() => createTailProductParser({ ...options, ...override }), { code: 'INVALID_CONFIG' });
  }
  const parser = createTailProductParser(options);
  options.delimiter[0] = 0;
  assert.deepEqual(parser.push(Uint8Array.of(1, 2, 255)), [Uint8Array.of(1, 2)]);
});

test('product metadata and all public entries expose only verified connection profiles', () => {
  assert.deepEqual(listDeviceProducts().map((item) => item.product), ['handGloveFullPacket', 'hand']);
  const profiles = listDeviceProducts();
  profiles[0].baudRate = 1;
  assert.equal(listDeviceProducts()[0].baudRate, 921600);
  for (const entry of [NodeShroom, WebShroom]) {
    for (const name of ['connectProduct', 'connectGlove', 'connectHandPad', 'listDeviceProducts']) assert.equal(typeof entry[name], 'function');
  }
});

test('product configuration hides protocol details and validates before any transport action', () => {
  for (const options of [null, [], {}, { product: 'unknown' }, { product: 'handGloveFullPacket' },
    { product: 'handGloveFullPacket', side: 'auto' }, { product: 'hand', side: 'left' },
    { product: 'hand', baudRate: 9600 }, { product: 'hand', layout: 'raw' },
    { product: 'hand', onData: 1 }, { product: 'hand', onError: 'log' }]) {
    assert.throws(() => prepareProductConnection(options), { code: 'INVALID_CONFIG', stage: 'configure' });
  }
  const session = prepareProductConnection({ product: 'handGloveFullPacket', side: 'right' });
  assert.equal(session.serialOptions.baudRate, 921600);
  assert.equal(session.info.side, 'right');
  assert.equal(session.info.rows, 13);
});

test('hand pad emits the first tail-delimited frame and matches existing mat32 mapping exactly', () => {
  const payload = Uint8Array.from({ length: 1024 }, (_, i) => (i * 17) & 255);
  const parser = createProductParser('hand');
  const [frame] = parser.push(wire(payload));
  const expected = decodeFrame(payload, { layout: 'mat32' });
  assert.equal(frame.product, 'hand');
  assert.equal(frame.rows, 32);
  assert.equal(frame.cols, 32);
  assert.deepEqual(frame.raw, payload);
  assert.deepEqual(frame.values, expected.values);
  assert.deepEqual(frame.pressureMatrix, Uint8Array.from(expected.values, (value) => Math.round(value * 255)));
  assert.equal(parser.frameLength, 1024);
  assert.equal(parser.droppedCount, 0);
});

test('product stream handles every one-byte fragment, leading delimiter and sticky frames', () => {
  const payload = new Uint8Array(274);
  payload[0] = 42;
  payload[1] = 2;
  payload.fill(127, 2, 258);
  payload.fill(33, 258);
  const parser = createProductParser('handGloveFullPacket', { side: 'left' });
  const frames = [];
  for (const byte of [...tail, ...wire(payload), ...wire(payload)]) frames.push(...parser.push(Uint8Array.of(byte)));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].sequence, 42);
  assert.equal(frames[0].side, 'left');
  assert.equal(frames[0].packetType, 2);
  assert.equal(frames[0].pressure.length, 256);
  assert.equal(frames[0].pressureMatrix.length, 195);
  assert.deepEqual([...frames[0].imu.raw], new Array(16).fill(33));
  assert.equal(parser.droppedCount, 0);
  assert.equal(parser.push(Uint8Array.from([...wire(payload), ...wire(payload)])).length, 2);
});

test('bad and oversize segments are dropped, recovery is bounded, and reset clears counts', () => {
  const parser = createProductParser('hand');
  parser.push(Uint8Array.from([1, 2, ...tail]));
  assert.equal(parser.droppedCount, 1);
  assert.deepEqual(parser.push(new Uint8Array(100000)), []);
  // Oversize segments must not be converted into fake last-1024-byte packets.
  assert.deepEqual(parser.push(Uint8Array.from(tail)), []);
  assert.equal(parser.droppedCount, 2);
  assert.equal(parser.push(wire(new Uint8Array(1024))).length, 1);
  assert.equal(parser.frameLength, 1024);
  parser.reset();
  assert.equal(parser.frameLength, 0);
  assert.equal(parser.droppedCount, 0);
  assert.throws(() => parser.push('bytes'), { code: 'PARSE_FAILED', stage: 'parse' });
});

test('classic browser bundle exposes the same high-level product entry points', async () => {
  const source = await readFile(new URL('../web/shroom.bundle.js', import.meta.url), 'utf8');
  const browser = { console };
  runInNewContext(source, browser);
  for (const name of ['connectProduct', 'connectGlove', 'connectHandPad', 'listDeviceProducts']) assert.equal(typeof browser.Shroom[name], 'function');
  assert.equal(browser.Shroom.listDeviceProducts().length, 2);
  await assert.rejects(browser.Shroom.connectGlove({ side: 'auto' }), { code: 'INVALID_CONFIG' });
});

test('classic browser product callback also delivers anatomical regions', async () => {
  const source = await readFile(new URL('../web/shroom.bundle.js', import.meta.url), 'utf8');
  const payload = new Uint8Array(274);
  for (let i = 0; i < 256; i++) payload[2 + i] = i;
  let reads = 0;
  let finishRead;
  let closed = 0;
  const reader = {
    read() {
      if (reads++ === 0) return Promise.resolve({ value: wire(payload), done: false });
      return new Promise((resolve) => { finishRead = resolve; });
    },
    async cancel() { finishRead?.({ done: true }); },
    releaseLock() {},
  };
  const port = { readable: { getReader: () => reader }, async open() {}, async close() { closed++; } };
  const browser = { console, Uint8Array, ...licenseBrowserGlobals, navigator: { serial: { requestPort: async () => port } } };
  runInNewContext(source, browser);
  await activateTestLicense({}, browser.Shroom);
  const frames = [];
  const device = await browser.Shroom.connectGlove({ side: 'right', onData: (frame) => frames.push(frame) });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].fingers.thumb.pulp.raw[0], 46);
    assert.equal(frames[0].fingers.little.raw[0], 227);
    assert.equal(frames[0].palm.raw.length, 72);
    assert.equal(frames[0].palm.matrix[0].length, 12);
  } finally { await device.close(); }
  assert.equal(closed, 1);
});
