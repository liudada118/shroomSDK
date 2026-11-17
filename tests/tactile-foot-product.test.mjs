import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createProductParser, listDeviceProducts, prepareProductConnection } from '../src/core/product.js';
import { decodeStreamFrame, encodeStreamFrame } from '../src/core/stream-codec.js';
import { createProductMockDevice } from '../src/core/mock.js';

const tail = Uint8Array.of(0xaa, 0x55, 0x03, 0x99);
const concatenate = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));

/** Independent synthetic wire bytes, including non-finite float bit patterns in the opaque IMU. */
function sample(type = 3, offset = 0) {
  const pressure = Uint8Array.from({ length: 256 }, (_, i) => (i + offset) & 255);
  const imu = Uint8Array.of(0, 0, 192, 127, 0, 0, 128, 127, 0, 0, 128, 255, 255, 0, 128, 1);
  const first = concatenate([1, type], pressure.slice(0, 128), tail);
  const second = concatenate([2, type], pressure.slice(128), imu, tail);
  return { pressure, imu, first, second, wire: concatenate(first, second) };
}

/** Assert the protocol's original bytes without deriving expected results from the adapter. */
function assertOriginal(frame, fixture, type = 3) {
  assert.equal(frame.product, 'footVideo');
  assert.equal(frame.protocol, 'segmented');
  assert.equal(frame.side, type === 3 ? 'left' : 'right');
  assert.equal(frame.packetType, type);
  assert.equal(Object.hasOwn(frame, 'sequence'), false);
  assert.equal(frame.rows, 16);
  assert.equal(frame.cols, 16);
  assert.ok(frame.raw instanceof Uint8Array);
  assert.ok(frame.pressure instanceof Uint8Array);
  assert.ok(frame.pressureMatrix instanceof Uint8Array);
  assert.deepEqual(frame.raw, fixture.pressure);
  assert.deepEqual(frame.pressure, fixture.pressure);
  assert.deepEqual(frame.pressureMatrix, fixture.pressure);
  assert.deepEqual(frame.values, Float32Array.from(fixture.pressure, value => value / 255));
  assert.deepEqual(frame.imu.raw, fixture.imu);
  assert.ok(frame.imu.raw instanceof Uint8Array);
  assert.equal(frame.rawPackets.length, 2);
  assert.ok(frame.rawPackets.every(packet => packet instanceof Uint8Array));
  assert.deepEqual(frame.rawPackets.map(packet => packet.length), [134, 150]);
  assert.deepEqual(frame.rawPackets[0], fixture.first);
  assert.deepEqual(frame.rawPackets[1], fixture.second);
  assert.deepEqual(concatenate(...frame.rawPackets), fixture.wire);
  assert.equal(frame.fingers, undefined);
  assert.equal(frame.palm, undefined);
  assert.equal(frame.sensors, undefined);
}

test('tactile foot registers footVideo and foot separately from the legacy insole', () => {
  const profiles = listDeviceProducts();
  const profile = profiles.find(item => item.product === 'footVideo');
  assert.ok(profile);
  assert.equal(profile.label, '触觉足底');
  assert.equal(profile.baudRate, 921600);
  assert.equal(profile.payloadLength, 276);
  assert.equal(profile.sensorPoints, 256);
  assert.equal(profile.rows, 16);
  assert.equal(profile.cols, 16);
  assert.ok(profiles.some(item => item.product === 'jqInsole'));
  for (const product of ['footVideo', 'foot']) {
    const prepared = prepareProductConnection({ product }, 'node');
    assert.equal(prepared.info.product, 'footVideo');
    assert.equal(prepared.info.protocol, 'segmented');
    assert.equal(prepared.serialOptions.baudRate, 921600);
    assert.equal(createProductParser(product).push(sample().wire).length, 1);
  }
  for (const options of [null, [], { side: 'both' }, { side: 3 }]) {
    assert.throws(() => createProductParser('foot', options), { code: 'INVALID_CONFIG' });
  }
  for (const options of [{ baudRate: 115200 }, { rows: 32 }, { protocol: '12bit' }]) {
    assert.throws(() => prepareProductConnection({ product: 'foot', ...options }, 'node'), { code: 'INVALID_CONFIG' });
  }
});

for (const [type, side] of [[3, 'left'], [4, 'right']]) {
  test(`type ${type} identifies the ${side} foot and retains every pressure, IMU and wire byte`, () => {
    const fixture = sample(type);
    const parser = createProductParser('foot');
    assert.deepEqual(parser.push(fixture.first), []);
    const [frame] = parser.push(fixture.second);
    assertOriginal(frame, fixture, type);
    assert.equal(parser.frameLength, 276);
    assert.equal(parser.droppedCount, 0);
    const [manual] = createProductParser('foot', { side }).push(fixture.wire);
    assertOriginal(manual, fixture, type);
    const wire = JSON.parse(JSON.stringify(encodeStreamFrame(frame)));
    assert.deepEqual(wire.rawPackets, [Array.from(fixture.first), Array.from(fixture.second)]);
    assertOriginal(decodeStreamFrame(wire), fixture, type);
  });

  test(`${side} foot survives every possible read split and byte-sized/sticky delivery`, () => {
    const fixture = sample(type, 31);
    for (let split = 0; split <= fixture.wire.length; split++) {
      const parser = createProductParser('foot');
      const frames = [...parser.push(fixture.wire.slice(0, split)), ...parser.push(fixture.wire.slice(split))];
      assert.equal(frames.length, 1, `split ${split}`);
      assertOriginal(frames[0], fixture, type);
    }
    const parser = createProductParser('foot', { side: 'auto' });
    const frames = [];
    for (const byte of concatenate(tail, fixture.wire, fixture.wire)) frames.push(...parser.push(Uint8Array.of(byte)));
    assert.equal(frames.length, 2);
    frames.forEach(frame => assertOriginal(frame, fixture, type));
    assert.equal(parser.push(concatenate(fixture.wire, fixture.wire)).length, 2);
  });
}

test('foot types are strict in both automatic and explicit-side modes', () => {
  for (const side of [undefined, 'auto', 'left', 'right']) {
    for (const type of [0, 1, 2, 5, 128, 255]) {
      const parser = createProductParser('foot', side ? { side } : undefined);
      assert.deepEqual(parser.push(sample(type).wire), []);
      const validType = side === 'right' ? 4 : 3;
      assert.equal(parser.push(sample(validType).wire).length, 1);
    }
  }
  for (const [side, wrongType, correctType] of [['left', 4, 3], ['right', 3, 4]]) {
    const parser = createProductParser('foot', { side });
    assert.deepEqual(parser.push(sample(wrongType).wire), []);
    assertOriginal(parser.push(sample(correctType).wire)[0], sample(correctType), correctType);
  }
  for (const type of [3, 4]) {
    assert.deepEqual(createProductParser('glove', { side: 'auto' }).push(sample(type).wire), []);
  }
});

test('a mismatched or repeated tail consumes the head and newer heads replace older samples', () => {
  const left = sample(3, 3), right = sample(4, 17), newer = sample(3, 27);
  const parser = createProductParser('foot');
  assert.deepEqual(parser.push(concatenate(left.first, right.second, left.second)), []);
  assert.deepEqual(parser.push(left.second), []);
  const [frame] = parser.push(concatenate(left.first, newer.first, newer.second));
  assertOriginal(frame, newer);
  assert.deepEqual(parser.push(newer.second), []);
  assert.deepEqual(parser.push(newer.second), []);
  const frames = parser.push(concatenate(left.wire, right.wire));
  assert.deepEqual(frames.map(item => item.side), ['left', 'right']);
  assertOriginal(frames[0], left);
  assertOriginal(frames[1], right, 4);
});

test('noise, invalid packet boundaries and oversized chunks cannot bridge an older half-frame', () => {
  const fixture = sample();
  const invalid = [
    tail,
    concatenate([3], tail),
    concatenate([7, 3], fixture.pressure.slice(0, 128), tail),
    concatenate([1, 3], fixture.pressure.slice(0, 127), tail),
    concatenate(new Uint8Array(200000).fill(19), tail),
  ];
  for (const boundary of invalid) {
    const parser = createProductParser('foot');
    assert.deepEqual(parser.push(fixture.first), []);
    assert.deepEqual(parser.push(boundary), []);
    assert.deepEqual(parser.push(fixture.second), []);
    assertOriginal(parser.push(fixture.wire)[0], fixture);
  }
  assert.throws(() => createProductParser('foot').push('not bytes'), { code: 'PARSE_FAILED' });
});

test('timeout, backward time and reset clear uncompleted foot packets', t => {
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const fixture = sample();
  const parser = createProductParser('foot');
  parser.push(fixture.first);
  now += 1001;
  assert.deepEqual(parser.push(fixture.second), []);
  assertOriginal(parser.push(fixture.wire)[0], fixture);
  parser.push(fixture.first);
  now -= 1;
  assert.deepEqual(parser.push(fixture.second), []);
  parser.push(fixture.first);
  parser.reset();
  assert.deepEqual(parser.push(fixture.second), []);
  assertOriginal(parser.push(fixture.wire)[0], fixture);
});

test('retained wire packets are independent of input buffers, later parsing and encoded JSON', () => {
  const fixture = sample();
  const input = fixture.wire.slice();
  const parser = createProductParser('foot');
  const [frame] = parser.push(input);
  input.fill(0);
  parser.push(sample(4, 51).wire);
  assertOriginal(frame, fixture);
  const encoded = encodeStreamFrame(frame);
  const decoded = decodeStreamFrame(encoded);
  encoded.rawPackets[0].fill(0);
  encoded.imu.raw.fill(0);
  assertOriginal(frame, fixture);
  assertOriginal(decoded, fixture);
});

test('the stream codec refuses corrupted raw packets or fields inconsistent with the preserved bytes', () => {
  const [frame] = createProductParser('foot').push(sample().wire);
  const mutations = [
    source => { source.product = 'foot'; },
    source => { source.protocol = '12bit'; },
    source => { source.side = 'right'; },
    source => { source.packetType = 4; },
    source => { source.sequence = 0; },
    source => { source.raw[0] ^= 1; },
    source => { source.pressure[0] ^= 1; },
    source => { source.pressureMatrix.reverse(); },
    source => { source.values[0] = 0.5; },
    source => { source.imu.raw[0] ^= 1; },
    source => { source.rawPackets[0][0] = 2; },
    source => { source.rawPackets[1][1] = 4; },
    source => { source.rawPackets[0][2] ^= 1; },
    source => { source.rawPackets[1][130] ^= 1; },
    source => { source.rawPackets[0][133] ^= 1; },
    source => { source.rawPackets[1].pop(); },
    source => { source.rawPackets.push(source.rawPackets[0]); },
    source => { delete source.rawPackets; },
  ];
  for (const mutate of mutations) {
    const source = JSON.parse(JSON.stringify(encodeStreamFrame(frame)));
    mutate(source);
    assert.throws(() => decodeStreamFrame(source), { code: 'PARSE_FAILED' });
    assert.throws(() => encodeStreamFrame(source), { code: 'PARSE_FAILED' });
  }
});

for (const [side, type] of [['left', 3], ['right', 4]]) {
  test(`the ${side} foot mock uses the real parser and retains complete wire packets`, async t => {
    const device = createProductMockDevice({ product: 'foot', side });
    t.after(() => device.close());
    const frame = await new Promise((resolveFrame, reject) => {
      let off = () => {};
      const timer = setTimeout(() => { off(); reject(new Error('Tactile-foot mock frame timed out')); }, 2000);
      off = device.onData(value => { clearTimeout(timer); off(); resolveFrame(value); });
    });
    assert.equal(device.info.product, 'footVideo');
    assert.equal(frame.side, side);
    assert.equal(frame.packetType, type);
    assert.equal(frame.protocol, 'segmented');
    assert.equal(frame.raw.length, 256);
    assert.deepEqual(frame.raw, frame.pressure);
    assert.deepEqual(frame.pressureMatrix, frame.pressure);
    assert.deepEqual(frame.imu.raw, new Uint8Array(16));
    assert.deepEqual(frame.rawPackets[0], concatenate([1, type], frame.pressure.slice(0, 128), tail));
    assert.deepEqual(frame.rawPackets[1], concatenate([2, type], frame.pressure.slice(128), frame.imu.raw, tail));
    assert.equal(Object.hasOwn(frame, 'sequence'), false);
    assert.equal(device.frameLength, 276);
    const decoded = decodeStreamFrame(encodeStreamFrame(frame));
    assert.deepEqual(decoded.rawPackets, frame.rawPackets);
    await device.close();
    assert.equal(device.state, 'closed');
  });
}

test('the raw-foot CLI prints one complete right-foot JSON frame and exits in mock mode', async () => {
  const script = fileURLToPath(new URL('../examples/node/tactile-foot-raw.js', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [script, '--mock', '--side', 'right', '--frames', '1'], { windowsHide: true, timeout: 5000 });
  assert.equal(stderr, '');
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const frame = JSON.parse(lines[0]);
  assert.equal(frame.product, 'footVideo');
  assert.equal(frame.side, 'right');
  assert.equal(frame.packetType, 4);
  assert.equal(frame.pressure.length, 256);
  assert.equal(frame.imuRaw.length, 16);
  assert.deepEqual(frame.rawPackets[0], [1, 4, ...frame.pressure.slice(0, 128), ...tail]);
  assert.deepEqual(frame.rawPackets[1], [2, 4, ...frame.pressure.slice(128), ...frame.imuRaw, ...tail]);
});
