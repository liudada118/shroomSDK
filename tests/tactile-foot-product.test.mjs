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
// Independent 0-based golden orders transcribed from the desktop footL/footR source tables.
const goldenOrder = {
  left: [223, 207, 191, 175, 159, 143, 222, 206, 190, 174, 158, 142, 221, 205, 189, 173, 157, 141,
    220, 204, 188, 172, 156, 140, 219, 203, 187, 171, 155, 139, 218, 202, 186, 170, 154, 138,
    217, 201, 185, 169, 153, 137, 216, 200, 184, 168, 152, 136, 215, 199, 183, 167, 151, 135,
    214, 198, 182, 166, 150, 134],
  right: [22, 6, 246, 230, 214, 198, 23, 7, 247, 231, 215, 199, 24, 8, 248, 232, 216, 200,
    25, 9, 249, 233, 217, 201, 26, 10, 250, 234, 218, 202, 27, 11, 251, 235, 219, 203,
    28, 12, 252, 236, 220, 204, 29, 13, 253, 237, 221, 205, 30, 14, 254, 238, 222, 206,
    31, 15, 255, 239, 223, 207],
};

/** Extract expected original ADCs using the independent desktop golden order. */
function expectedPressure(scan, type) {
  return Uint8Array.from(goldenOrder[type === 3 ? 'left' : 'right'], index => scan[index]);
}

/** Independent synthetic wire bytes, including non-finite float bit patterns in the opaque IMU. */
function sample(type = 3, offset = 0) {
  const scan = Uint8Array.from({ length: 256 }, (_, i) => (i + offset) & 255);
  const imu = Uint8Array.of(0, 0, 192, 127, 0, 0, 128, 127, 0, 0, 128, 255, 255, 0, 128, 1);
  const first = concatenate([1, type], scan.slice(0, 128), tail);
  const second = concatenate([2, type], scan.slice(128), imu, tail);
  return { scan, imu, first, second, wire: concatenate(first, second) };
}

/** Assert the protocol's original bytes without deriving expected results from the adapter. */
function assertOriginal(frame, fixture, type = 3) {
  assert.equal(frame.product, 'footVideo');
  assert.equal(frame.protocol, 'segmented');
  assert.equal(frame.side, type === 3 ? 'left' : 'right');
  assert.equal(frame.packetType, type);
  assert.equal(Object.hasOwn(frame, 'sequence'), false);
  assert.equal(frame.rows, 10);
  assert.equal(frame.cols, 6);
  assert.ok(frame.raw instanceof Uint8Array);
  assert.ok(frame.pressure instanceof Uint8Array);
  assert.ok(frame.pressureMatrix instanceof Uint8Array);
  const pressure = expectedPressure(fixture.scan, type);
  assert.equal(frame.raw.length, 60);
  assert.deepEqual(frame.raw, pressure);
  assert.deepEqual(frame.pressure, pressure);
  assert.deepEqual(frame.pressureMatrix, pressure);
  assert.deepEqual(frame.values, Float32Array.from(pressure, value => value / 255));
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
  assert.equal(profile.sensorPoints, 60);
  assert.equal(profile.rows, 10);
  assert.equal(profile.cols, 6);
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

test('the two feet use their distinct physical 60-point orders as ten rows of six original ADCs', () => {
  const left = createProductParser('foot').push(sample(3).wire)[0];
  const right = createProductParser('foot').push(sample(4).wire)[0];
  assert.deepEqual(Array.from(left.pressure), goldenOrder.left);
  assert.deepEqual(Array.from(right.pressure), goldenOrder.right);
  assert.notDeepEqual(left.pressure, right.pressure);
  for (const [type, side] of [[3, 'left'], [4, 'right']]) {
    const fixture = sample(type);
    fixture.scan.fill(123);
    goldenOrder[side].forEach((index, i) => { fixture.scan[index] = i % 2 ? 255 : 0; });
    fixture.first = concatenate([1, type], fixture.scan.slice(0, 128), tail);
    fixture.second = concatenate([2, type], fixture.scan.slice(128), fixture.imu, tail);
    fixture.wire = concatenate(fixture.first, fixture.second);
    const [frame] = createProductParser('foot').push(fixture.wire);
    assertOriginal(frame, fixture, type);
    assert.deepEqual(Array.from(frame.pressure), Array.from({ length: 60 }, (_, i) => i % 2 ? 255 : 0));
    assert.equal(Object.hasOwn(frame, 'scanRaw'), false);
    assert.equal(Object.hasOwn(frame, 'scan'), false);
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
    concatenate([7, 3], fixture.scan.slice(0, 128), tail),
    concatenate([1, 3], fixture.scan.slice(0, 127), tail),
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
    source => { source.rawPackets[1][97] ^= 1; }, // Left-foot ADC223 is the first mapped point.
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

test('unmapped scan channels remain byte-exact in rawPackets without entering the sixty measured values', () => {
  const [frame] = createProductParser('foot').push(sample().wire);
  const source = encodeStreamFrame(frame);
  source.rawPackets[0][2] ^= 1; // Scan index0 is not a measured point on either foot.
  const decoded = decodeStreamFrame(source);
  assert.deepEqual(decoded.raw, frame.raw);
  assert.deepEqual(decoded.pressureMatrix, frame.pressureMatrix);
  assert.equal(decoded.rawPackets[0][2], source.rawPackets[0][2]);
  assert.deepEqual(encodeStreamFrame(decoded).rawPackets, source.rawPackets);
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
    assert.equal(frame.raw.length, 60);
    assert.deepEqual(frame.raw, frame.pressure);
    assert.deepEqual(frame.pressureMatrix, frame.pressure);
    assert.deepEqual(frame.imu.raw, new Uint8Array(16));
    assert.deepEqual(frame.rawPackets.map(packet => packet.length), [134, 150]);
    assert.deepEqual(frame.rawPackets[0].slice(0, 2), Uint8Array.of(1, type));
    assert.deepEqual(frame.rawPackets[1].slice(0, 2), Uint8Array.of(2, type));
    const scan = concatenate(frame.rawPackets[0].slice(2, 130), frame.rawPackets[1].slice(2, 130));
    assert.deepEqual(frame.pressure, expectedPressure(scan, type));
    assert.deepEqual(frame.rawPackets[1].slice(130, 146), frame.imu.raw);
    assert.deepEqual(frame.rawPackets[0].slice(-4), tail);
    assert.deepEqual(frame.rawPackets[1].slice(-4), tail);
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
  assert.equal(frame.pressure.length, 60);
  assert.equal(frame.imuRaw.length, 16);
  assert.deepEqual(frame.rawPackets.map(packet => packet.length), [134, 150]);
  const scan = [...frame.rawPackets[0].slice(2, 130), ...frame.rawPackets[1].slice(2, 130)];
  assert.deepEqual(frame.pressure, Array.from(expectedPressure(scan, 4)));
  assert.deepEqual(frame.rawPackets[1].slice(130, 146), frame.imuRaw);
  assert.deepEqual(frame.rawPackets[0].slice(-4), Array.from(tail));
  assert.deepEqual(frame.rawPackets[1].slice(-4), Array.from(tail));
});
