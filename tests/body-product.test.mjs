import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bodyProductAdapter } from '../src/core/products/body.js';
import { createProductParser, prepareProductConnection } from '../src/core/product.js';
import { encodeStreamFrame, decodeStreamFrame } from '../src/core/stream-codec.js';

const bodyTail = [0xaa, 0x55, 0x03, 0x99];
// 独立记录自上位机物理源表的尺寸、首末 0 基通道，不从 SDK 实现导入期望值。
const bodySourceProbes = {
  back: [6, 10, 618, 4], chest: [6, 10, 691, 69],
  rightArm: [6, 7, 735, 986], rightShoulder: [6, 3, 959, 890],
  leftArm: [6, 7, 1012, 729], leftShoulder: [6, 3, 884, 953],
  backPantsRight: [8, 5, 196, 320], backPantsLeft: [8, 5, 494, 362],
  frontPantsLeft: [8, 5, 499, 367], frontPantsRight: [8, 5, 201, 325],
};

/** 构造含完整帧尾的串口字节，测试不打开真实硬件。 */
function bodyWire(payload = Uint8Array.from({ length: 1024 }, (_, i) => (i * 17 + 3) % 256)) {
  return Uint8Array.from([...payload, ...bodyTail]);
}

/** 只调用人体适配器，避免注册表集成顺序影响该协议的独立测试。 */
function bodyFrame(payload) {
  const [frame] = bodyProductAdapter.createParser().push(bodyWire(payload));
  return frame;
}

/** 模拟公共编解码器交付的已校验基础字段，独立验证产品 WS 字段契约。 */
function bodyStreamFields(input, typed) {
  const output = {
    raw: typed ? Uint8Array.from(input.raw) : Array.from(input.raw),
    values: typed ? Float32Array.from(input.values) : Array.from(input.values),
    rows: input.rows, cols: input.cols, min: input.min, max: input.max,
    avg: input.avg, area: input.area, center: { ...input.center }, timestamp: input.timestamp,
  };
  return bodyProductAdapter.readStreamFields(input, output, typed);
}

test('human body profile distinguishes 1024 scanned channels from 400 mapped channels and rejects side', () => {
  assert.deepEqual(bodyProductAdapter.profile, {
    product: 'humanBody', label: '人体全身', family: 'body', baudRate: 1000000,
    payloadLength: 1024, sensorPoints: 1024, mappedSensorPoints: 400, rows: 32, cols: 32,
  });
  assert.deepEqual(bodyProductAdapter.aliases, ['body']);
  assert.deepEqual(bodyProductAdapter.optionFields, []);
  for (const options of [{ side: 'left' }, { side: 'right' }, { side: undefined }, null, []]) {
    assert.throws(() => bodyProductAdapter.createParser(options), { code: 'INVALID_CONFIG' });
  }
});

test('humanBody and body use the registered parser and public stream codec with the canonical output ID', () => {
  for (const product of ['humanBody', 'body']) {
    const prepared = prepareProductConnection({ product }, 'node');
    assert.equal(prepared.serialOptions.baudRate, 1000000);
    assert.equal(prepared.info.product, 'humanBody');
    const [frame] = createProductParser(product).push(bodyWire());
    assert.equal(frame.product, 'humanBody');
    assert.deepEqual(decodeStreamFrame(JSON.parse(JSON.stringify(encodeStreamFrame(frame)))), frame);
    assert.throws(() => prepareProductConnection({ product, side: 'left' }, 'node'), { code: 'INVALID_CONFIG' });
  }
});

test('human body uses the exact physical source table with 400 unique channels and original row direction', () => {
  const frame = bodyFrame();
  assert.equal(frame.product, 'humanBody');
  assert.equal(frame.rows, 32);
  assert.equal(frame.cols, 32);
  assert.equal(frame.raw.length, 1024);
  assert.equal(frame.pressure, frame.raw);
  assert.deepEqual(frame.pressureMatrix, frame.raw);
  assert.deepEqual(Array.from(frame.values), Array.from(frame.raw, (value) => Math.fround(value / 255)));
  assert.deepEqual(Object.keys(frame.regions), Object.keys(bodySourceProbes));
  const indicesByKey = {};
  for (const [key, [rows, cols, firstIndex, lastIndex]] of Object.entries(bodySourceProbes)) {
    const region = frame.regions[key];
    assert.equal(region.name, key);
    assert.equal(region.rows, rows);
    assert.equal(region.cols, cols);
    assert.equal(region.sourceIndices[0], firstIndex);
    assert.equal(region.sourceIndices.at(-1), lastIndex);
    assert.equal(region.sourceIndices.length, rows * cols);
    assert.ok(region.sourceIndices instanceof Uint16Array);
    assert.ok(region.raw instanceof Uint8Array);
    assert.ok(region.values instanceof Float32Array);
    assert.equal(region.matrix.length, rows);
    assert.ok(region.matrix.every((row) => row.length === cols));
    assert.deepEqual(Array.from(region.raw), Array.from(region.sourceIndices, (index) => frame.raw[index]));
    assert.deepEqual(region.matrix.flat(), Array.from(region.raw));
    assert.deepEqual(Array.from(region.values), Array.from(region.raw, (value) => Math.fround(value / 255)));
    indicesByKey[key] = Array.from(region.sourceIndices);
  }
  const indices = Object.values(indicesByKey).flat();
  assert.equal(indices.length, 400);
  assert.equal(new Set(indices).size, 400);
  assert.equal(Math.min(...indices), 0);
  assert.equal(Math.max(...indices), 1023);
  // 该摘要直接从 humanBodyRawLayout.js 的 1 基表转换得出，覆盖所有 400 个位置及排列。
  assert.equal(createHash('sha256').update(JSON.stringify(indicesByKey)).digest('hex'), 'bd85c8fbc2535d0b9dc52a067042d029ce079d18971d90d939222c83b2948a54');
});

test('human body preserves unmapped scan data and channels above 255 without wrapping, filtering or duplication', () => {
  const raw = new Uint8Array(1024);
  raw[1023] = 231;
  raw[255] = 17;
  raw[23] = 99; // 通道 24 不属于当前十块物理矩阵，但完整扫描数据不能丢失。
  raw[618] = 1; // 极小 ADC 也不能套用热力图阈值归零。
  const frame = bodyFrame(raw);
  assert.equal(frame.regions.rightArm.sourceIndices[5], 1023);
  assert.equal(frame.regions.rightArm.raw[5], 231);
  assert.equal(frame.regions.rightArm.matrix[0][5], 231);
  assert.equal(frame.regions.back.raw[0], 1);
  assert.equal(frame.regions.back.rows, 6); // 胸背没有为显示重复成 12 行。
  assert.equal(frame.pressureMatrix[23], 99);
  assert.equal(frame.values[23], Math.fround(99 / 255));
  assert.ok(Object.values(frame.regions).every((region) => !region.sourceIndices.includes(23)));
});

test('human body framing supports split tails, sticky frames and discards incomplete or overlong payloads', () => {
  const parser = bodyProductAdapter.createParser();
  const packet = bodyWire();
  const frames = [];
  for (const byte of packet) frames.push(...parser.push(Uint8Array.of(byte)));
  assert.equal(frames.length, 1);
  assert.equal(parser.frameLength, 1024);
  assert.equal(parser.droppedCount, 0);
  const next = parser.push(Uint8Array.from([...bodyTail, ...packet, ...packet]));
  assert.equal(next.length, 2);
  assert.deepEqual(next[0].regions, frames[0].regions);
  assert.equal(parser.push(bodyWire(new Uint8Array(1023))).length, 0);
  assert.equal(parser.push(bodyWire(new Uint8Array(1025))).length, 0);
  assert.equal(parser.droppedCount, 2);
  assert.equal(parser.push(packet).length, 1);
  parser.push(packet.slice(0, 700));
  parser.reset();
  assert.equal(parser.droppedCount, 0);
  assert.equal(parser.frameLength, 0);
  assert.equal(parser.push(packet.slice(700)).length, 0);
  assert.equal(parser.push(packet).length, 1);
});

test('human body frame snapshots cannot corrupt later parser output or the canonical source table', () => {
  const parser = bodyProductAdapter.createParser();
  const wire = bodyWire();
  const [first] = parser.push(wire);
  const expected = bodyFrame();
  wire.fill(0);
  assert.deepEqual(first.raw, expected.raw);
  assert.deepEqual(first.regions, expected.regions);
  first.raw.fill(255);
  first.regions.back.sourceIndices.fill(1);
  first.regions.back.raw.fill(255);
  first.regions.back.values.fill(1);
  first.regions.back.matrix[0].fill(255);
  const [second] = parser.push(bodyWire());
  assert.deepEqual(second.regions, expected.regions);
  assert.deepEqual(second.raw, expected.raw);
});

test('human body WS fields round-trip to independent arrays including Uint16 indices above 255', () => {
  const original = bodyFrame();
  const plain = bodyStreamFields(original, false);
  assert.ok(Array.isArray(plain.raw));
  assert.ok(Array.isArray(plain.regions.rightArm.sourceIndices));
  const json = JSON.parse(JSON.stringify(plain));
  const decoded = bodyStreamFields(json, true);
  assert.deepEqual(decoded, original);
  assert.equal(decoded.pressure, decoded.raw);
  assert.equal(decoded.regions.rightArm.sourceIndices[5], 1023);
  assert.ok(decoded.regions.rightArm.sourceIndices instanceof Uint16Array);
  json.regions.rightArm.sourceIndices[5] = 0;
  assert.equal(decoded.regions.rightArm.sourceIndices[5], 1023);
  decoded.regions.back.matrix[0][0] ^= 1;
  assert.notEqual(decoded.regions.back.matrix[0][0], original.regions.back.matrix[0][0]);
});

test('human body WS rejects forged indices, reshaped regions and values inconsistent with scanned ADC', () => {
  const mutations = [
    ['above-range index', (frame) => { frame.regions.rightArm.sourceIndices[5] = 1024; }],
    ['negative index', (frame) => { frame.regions.back.sourceIndices[0] = -1; }],
    ['fractional index', (frame) => { frame.regions.back.sourceIndices[0] = 618.5; }],
    ['string index', (frame) => { frame.regions.back.sourceIndices[0] = '618'; }],
    ['wrapped index', (frame) => { frame.regions.rightArm.sourceIndices[5] = 255; }],
    ['wrong but valid channel', (frame) => { frame.regions.back.sourceIndices[0] = 619; }],
    ['duplicate channel', (frame) => { frame.regions.back.sourceIndices[1] = frame.regions.back.sourceIndices[0]; }],
    ['missing region', (frame) => { delete frame.regions.chest; }],
    ['unknown region', (frame) => { frame.regions.front = frame.regions.chest; }],
    ['wrong name', (frame) => { frame.regions.back.name = 'chest'; }],
    ['repeated display rows', (frame) => { frame.regions.chest.rows = 12; }],
    ['short index list', (frame) => { frame.regions.back.sourceIndices.pop(); }],
    ['wrong region ADC', (frame) => { frame.regions.back.raw[0] ^= 1; }],
    ['wrong normalized value', (frame) => { frame.regions.back.values[0] = 2; }],
    ['non-finite value', (frame) => { frame.regions.back.values[0] = Infinity; }],
    ['wrong matrix value', (frame) => { frame.regions.back.matrix[0][0] ^= 1; }],
    ['wrong matrix columns', (frame) => { frame.regions.back.matrix[0].pop(); }],
    ['different scan matrix', (frame) => { frame.pressureMatrix[0] ^= 1; }],
    ['different scan normalization', (frame) => { frame.values[0] = 2; }],
    ['short payload', (frame) => { frame.raw.pop(); frame.pressure.pop(); }],
    ['alias on wire', (frame) => { frame.product = 'body'; }],
  ];
  for (const [name, mutate] of mutations) {
    const input = bodyStreamFields(bodyFrame(), false);
    mutate(input);
    assert.throws(() => bodyStreamFields(input, true), { code: 'PARSE_FAILED' }, name);
  }
});
