import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductParser, listDeviceProducts, prepareProductConnection } from '../src/core/product.js';
import { encodeStreamFrame, decodeStreamFrame } from '../src/core/stream-codec.js';
import { decodeGlovePacket } from '../src/core/glove.js';

const tail = [0xaa, 0x55, 0x03, 0x99];
const wire = payload => Uint8Array.from([...payload, ...tail]);
const concatenate = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));

function sample(side = 'left', offset = 0) {
  const type = side === 'left' ? 1 : 2;
  const pressure = Uint8Array.from({ length: 256 }, (_, index) => (index + offset) & 255);
  const imu = Uint8Array.of(0, 0, 128, 63, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 128, 62);
  const first = concatenate([1, type], pressure.slice(0, 128));
  const second = concatenate([2, type], pressure.slice(128), imu);
  return { first, second, pressure, imu, bytes: concatenate(wire(first), wire(second)) };
}

test('glove now selects segmented protocol while the explicit full-packet entry remains available', () => {
  const profiles = listDeviceProducts();
  assert.equal(profiles[0].product, 'handGloveSegmented');
  assert.equal(profiles[0].payloadLength, 276);
  assert.equal(profiles[0].firstPacketLength, 130);
  assert.equal(profiles[0].secondPacketLength, 146);
  const options = prepareProductConnection({ product: 'glove', side: 'left' }, 'node');
  assert.equal(options.info.product, 'handGloveSegmented');
  assert.equal(options.info.protocol, 'segmented');
  assert.equal(options.serialOptions.baudRate, 921600);
  assert.equal(prepareProductConnection({ product: 'handGloveFullPacket', side: 'left' }).info.product, 'handGloveFullPacket');
  for (const value of [null, {}, { side: 'auto' }, { side: 1 }]) {
    assert.throws(() => createProductParser('glove', value), { code: 'INVALID_CONFIG' });
  }
});

for (const side of ['left', 'right']) {
  test(`${side} segmented glove emits only after matching packets and preserves independent pressure/IMU snapshots`, () => {
    const parser = createProductParser('glove', { side });
    const fixture = sample(side);
    assert.deepEqual(parser.push(wire(fixture.first)), []);
    const [frame] = parser.push(wire(fixture.second));
    assert.equal(frame.product, 'handGloveSegmented');
    assert.equal(frame.protocol, 'segmented');
    assert.equal(frame.side, side);
    assert.equal(frame.packetType, side === 'left' ? 1 : 2);
    assert.equal(Object.hasOwn(frame, 'sequence'), false, 'packet ordinal is not a sample sequence');
    assert.deepEqual(frame.pressure, fixture.pressure);
    assert.equal(frame.raw, frame.pressure);
    assert.deepEqual(frame.imu.raw, fixture.imu);
    assert.equal(frame.palm.raw.length, 72);
    assert.equal(frame.fingers.thumb.raw.length, 12);
    assert.equal(frame.fingers.thumb.pulp.raw.length, 1);
    assert.deepEqual(frame.palm.rowLengths, [12, 15, 15, 15, 15]);
    const full = decodeGlovePacket(concatenate([17, frame.packetType], fixture.pressure, fixture.imu), { side });
    assert.deepEqual(frame.fingers, full.fingers);
    assert.deepEqual(frame.palm, full.palm);
    assert.deepEqual(frame.pressureMatrix, full.pressureMatrix);
    fixture.first.fill(0); fixture.second.fill(0);
    parser.push(sample(side, 20).bytes);
    assert.deepEqual(frame.pressure, fixture.pressure);
    assert.deepEqual(frame.imu.raw, fixture.imu);
    assert.equal(parser.frameLength, 276);
    assert.equal(parser.droppedCount, 0);
  });
}

test('byte-sized chunks, tail fragments and sticky packets deliver exactly one frame per pair', () => {
  const parser = createProductParser('glove', { side: 'left' });
  const fixture = sample();
  const frames = [];
  for (const byte of concatenate(tail, fixture.bytes, fixture.bytes)) frames.push(...parser.push(Uint8Array.of(byte)));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0].pressure, fixture.pressure);
  assert.equal(parser.push(concatenate(fixture.bytes, fixture.bytes)).length, 2);
  assert.equal(parser.droppedCount, 0);
});

test('one connection keeps only its latest head and never combines different packet types', () => {
  const left = sample('left', 7), right = sample('right', 35);
  const bytes = concatenate(wire(left.first), wire(right.first), wire(right.second), wire(left.second));
  for (const side of ['left', 'right']) {
    const parser = createProductParser('glove', { side });
    const frames = parser.push(bytes);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].pressure, right.pressure);
    assert.ok(frames.every(frame => frame.side === side));
    assert.equal(frames[0].packetType, 2);
  }
  const parser = createProductParser('glove', { side: 'left' });
  assert.deepEqual(parser.push(concatenate(wire(right.first), wire(left.second))), [], 'other-side head is never usable');
  assert.deepEqual(parser.push(wire(right.second)), [], 'mismatched tail consumes prior head instead of retaining it');
  assert.equal(parser.push(right.bytes).length, 1, 'manual side does not filter protocol pair type');
});

test('manual side matches upstream: type 2 can be configured left, and type 1 can be configured right', () => {
  for (const side of ['left', 'right']) {
    const fixture = sample(side === 'left' ? 'right' : 'left');
    const [frame] = createProductParser('glove', { side }).push(fixture.bytes);
    assert.equal(frame.side, side);
    assert.equal(frame.packetType, side === 'left' ? 2 : 1);
    const expected = decodeGlovePacket(concatenate([0, frame.packetType], fixture.pressure, fixture.imu), { side });
    assert.deepEqual(frame.fingers, expected.fingers);
    assert.deepEqual(frame.palm, expected.palm);
    assert.equal(decodeStreamFrame(encodeStreamFrame(frame)).side, side);
  }
});

test('packet type is an opaque pairing byte, not a side filter or a sample sequence', () => {
  for (const packetType of [0, 3, 128, 255]) {
    const fixture = sample('left');
    fixture.first[1] = packetType;
    fixture.second[1] = packetType;
    const [frame] = createProductParser('glove', { side: 'right' }).push(concatenate(wire(fixture.first), wire(fixture.second)));
    assert.equal(frame.side, 'right');
    assert.equal(frame.packetType, packetType);
    assert.equal(Object.hasOwn(frame, 'sequence'), false);
    assert.equal(decodeStreamFrame(encodeStreamFrame(frame)).packetType, packetType);
  }
});

test('orphan, repeated and out-of-order tail packets never replay an earlier head', () => {
  const fixture = sample();
  const parser = createProductParser('glove', { side: 'left' });
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.equal(parser.push(fixture.bytes).length, 1);
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.equal(parser.droppedCount, 3);
  const replacement = sample('left', 4);
  parser.push(wire(fixture.first));
  parser.push(wire(replacement.first));
  const [frame] = parser.push(wire(replacement.second));
  assert.deepEqual(frame.pressure, replacement.pressure, 'new head replaces uncompleted older head');
});

test('malformed lengths, headers, empty boundaries and reset controls clear pending head', () => {
  const fixture = sample();
  const invalid = [
    Uint8Array.of(9), fixture.first.slice(0, 129),
    concatenate([2, 1], fixture.first.slice(2)),
    concatenate([7, 1], fixture.second.slice(2)), Uint8Array.of(3), new Uint8Array(),
  ];
  for (const payload of invalid) {
    const parser = createProductParser('glove', { side: 'left' });
    parser.push(wire(fixture.first));
    assert.deepEqual(parser.push(wire(payload)), []);
    assert.deepEqual(parser.push(wire(fixture.second)), [], 'bad packet or reset must break prior pairing');
    assert.equal(parser.push(fixture.bytes).length, 1);
  }
});

test('oversized noisy input is bounded and cannot salvage a stale head or suffix into a frame', () => {
  const fixture = sample();
  const parser = createProductParser('glove', { side: 'left' });
  parser.push(wire(fixture.first));
  assert.deepEqual(parser.push(new Uint8Array(200000).fill(10)), []);
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.equal(parser.push(fixture.bytes).length, 1);
  assert.ok(parser.droppedCount >= 2);
  assert.throws(() => parser.push('not-bytes'), { code: 'PARSE_FAILED' });
});

test('pair timeout, backward clock and reconnect reset cannot retain a previous half-frame', t => {
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const fixture = sample();
  const parser = createProductParser('glove', { side: 'left' });
  parser.push(wire(fixture.first));
  now += 1001;
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.equal(parser.push(fixture.bytes).length, 1);
  parser.push(wire(fixture.first));
  now -= 1;
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  parser.push(wire(fixture.first));
  parser.reset();
  assert.equal(parser.frameLength, 0);
  assert.equal(parser.droppedCount, 0);
  assert.deepEqual(parser.push(wire(fixture.second)), []);
  assert.equal(parser.push(fixture.bytes).length, 1);
});

test('WS codec preserves segmented identity and rejects invented sequence or invalid pairing metadata', () => {
  const [frame] = createProductParser('glove', { side: 'right' }).push(sample('right').bytes);
  const encoded = encodeStreamFrame(frame);
  assert.equal(encoded.product, 'handGloveSegmented');
  assert.equal(encoded.protocol, 'segmented');
  assert.equal(Object.hasOwn(encoded, 'sequence'), false);
  assert.deepEqual(encoded.raw, Array.from(frame.raw));
  const decoded = decodeStreamFrame(JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded.raw instanceof Uint8Array, true);
  assert.equal(decoded.raw, decoded.pressure);
  assert.deepEqual(decoded.fingers, frame.fingers);
  assert.deepEqual(decoded.palm, frame.palm);
  assert.deepEqual(decoded.imu.raw, frame.imu.raw);
  for (const override of [{ sequence: 1 }, { sequence: undefined }, { packetType: 256 }, { packetType: -1 }, { protocol: 'full' }, { imu: { raw: [] } }]) {
    assert.throws(() => encodeStreamFrame({ ...frame, ...override }), { code: 'PARSE_FAILED' });
  }
});

test('explicit full-packet parser and codec retain the prior wire contract', () => {
  const fixture = sample('right');
  const payload = concatenate([42, 5], fixture.pressure, fixture.imu);
  const [frame] = createProductParser('handGloveFullPacket', { side: 'right' }).push(wire(payload));
  assert.equal(frame.sequence, 42);
  assert.equal(frame.packetType, 5);
  assert.equal(frame.protocol, undefined);
  const encoded = encodeStreamFrame(frame);
  assert.equal(encoded.product, 'handGloveFullPacket');
  assert.equal(encoded.sequence, 42);
  assert.equal(encoded.packetType, 5);
  assert.deepEqual(decodeStreamFrame(encoded).pressure, fixture.pressure);
});
