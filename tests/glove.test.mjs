import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGlovePacket } from '../core/glove.js';
import { ShroomError } from '../core/errors.js';

// Captured 1-based product mappings; zero denotes an outline position without a sensor.
const gloveExpectedMappings = {
  left: [
    65, 66, 67, 38, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
    49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
    33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    0, 2, 0, 0, 5, 0, 0, 8, 0, 0, 11, 0, 0, 14, 0,
    0, 0, 0, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
    0, 0, 0, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239,
    129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
    145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
    161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175,
    177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191,
    193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207,
    209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223,
  ],
  right: [
    190, 191, 192, 187, 188, 189, 184, 185, 186, 181, 182, 183, 178, 179, 180,
    206, 207, 208, 203, 204, 205, 200, 201, 202, 197, 198, 199, 194, 195, 196,
    222, 223, 224, 219, 220, 221, 216, 217, 218, 213, 214, 215, 210, 211, 212,
    238, 239, 240, 235, 236, 237, 232, 233, 234, 229, 230, 231, 226, 227, 228,
    0, 255, 0, 0, 252, 0, 0, 249, 0, 0, 246, 0, 0, 243, 0,
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 0, 0,
    18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 0, 0, 0,
    114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128,
    98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
    82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
    66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
    50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
    34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
  ],
};

/** Build a full payload containing visible byte boundaries and opaque IMU data. */
function gloveTestPayload() {
  const payload = new Uint8Array(274);
  payload[0] = 249;
  payload[1] = 1;
  for (let i = 0; i < 256; i += 1) payload[2 + i] = i;
  payload.set([0, 0, 128, 63, 0, 0, 0, 192, 0xaa, 0x55, 3, 0x99, 0, 0, 128, 127], 258);
  return payload;
}

for (const side of ['left', 'right']) {
  test(`full-packet glove preserves the existing ${side} mapping and ADC bytes`, () => {
    const payload = gloveTestPayload();
    const original = Uint8Array.from(payload);
    const frame = decodeGlovePacket(payload, { side });
    assert.equal(frame.product, 'handGloveFullPacket');
    assert.equal(frame.side, side);
    assert.equal(frame.sequence, 249);
    assert.equal(frame.packetType, 1);
    assert.equal(frame.rows, 13);
    assert.equal(frame.cols, 15);
    assert.equal(frame.values.length, 195);
    assert.equal(gloveExpectedMappings[side].length, 195);
    assert.deepEqual(frame.pressure, original.slice(2, 258));
    assert.equal(frame.raw, frame.pressure);
    assert.deepEqual(frame.pressureMatrix, Uint8Array.from(gloveExpectedMappings[side], (point) => point ? point - 1 : 0));
    assert.deepEqual(frame.values, Float32Array.from(frame.pressureMatrix, (value) => value / 255));
    assert.deepEqual(frame.imu, { raw: original.slice(258, 274) });
    assert.deepEqual(payload, original);
    payload.fill(0);
    assert.deepEqual(frame.pressure, original.slice(2, 258), 'retained frames must not alias serial buffers');
    assert.deepEqual(frame.imu.raw, original.slice(258, 274));
  });
}

test('full-packet glove uses explicit side, not packetType', () => {
  const payload = gloveTestPayload();
  for (const packetType of [0, 1, 2, 255]) {
    payload[1] = packetType;
    const left = decodeGlovePacket(payload, { side: 'left' });
    const right = decodeGlovePacket(payload, { side: 'right' });
    assert.equal(left.side, 'left');
    assert.equal(right.side, 'right');
    assert.equal(left.packetType, packetType);
    assert.equal(left.pressureMatrix[0], 64);
    assert.equal(right.pressureMatrix[0], 189);
  }
});

test('full-packet glove validates product configuration and strict payload length', () => {
  for (const options of [undefined, null, {}, [], { side: 'auto' }, { side: 'LEFT' }, { side: true }]) {
    assert.throws(() => decodeGlovePacket(gloveTestPayload(), options), (error) =>
      error instanceof ShroomError && error.code === 'INVALID_CONFIG' && error.stage === 'configure');
  }
  for (const payload of [undefined, null, new Array(274).fill(0), new Uint8Array(273), new Uint8Array(275), new Uint8Array(278)]) {
    assert.throws(() => decodeGlovePacket(payload, { side: 'left' }), (error) =>
      error instanceof ShroomError && error.code === 'PARSE_FAILED' && error.stage === 'parse');
  }
  assert.throws(() => decodeGlovePacket(gloveTestPayload(), { side: 'left', fullScale: 0 }), { code: 'INVALID_CONFIG' });
});

test('full-packet glove statistics describe the mapped outline, not metadata or IMU', () => {
  const payload = new Uint8Array(274);
  payload[0] = 255;
  payload.fill(100, 2, 258);
  payload.fill(255, 258);
  const frame = decodeGlovePacket(payload, { side: 'left', fullScale: 100, threshold: 0.5 });
  const occupied = gloveExpectedMappings.left.filter(Boolean).length;
  assert.equal(frame.min, 0);
  assert.equal(frame.max, 1);
  assert.equal(frame.avg, occupied / 195);
  assert.equal(frame.area, occupied);
  assert.ok(frame.center.x >= 0 && frame.center.x <= 1);
  assert.ok(frame.center.y >= 0 && frame.center.y <= 1);
  assert.equal(frame.imu.raw.length, 16);
});

test('glove decoding adds user-defined anatomical regions without changing the legacy matrix', () => {
  const payload = gloveTestPayload();
  const left = decodeGlovePacket(payload, { side: 'left', fullScale: 100 });
  const right = decodeGlovePacket(payload, { side: 'right', fullScale: 100 });
  assert.deepEqual([...left.fingers.thumb.raw], [18, 17, 16, 2, 1, 0, 242, 241, 240, 226, 225, 224]);
  assert.deepEqual([...right.fingers.thumb.raw], [239, 238, 237, 255, 254, 253, 15, 14, 13, 31, 30, 29]);
  assert.equal(left.fingers.index.pulp.raw[0], 212);
  assert.equal(right.fingers.index.pulp.raw[0], 43);
  assert.equal(left.palm.raw.length, 72);
  assert.deepEqual(left.palm.rowLengths, [12, 15, 15, 15, 15]);
  assert.deepEqual(right.palm.matrix.map((row) => row.length), [12, 15, 15, 15, 15]);
  assert.ok(Math.abs(left.fingers.index.pulp.values[0] - 2.12) < 1e-6);
  // The legacy display mapping stays compatible while new anatomy uses the supplied table.
  assert.equal(left.pressureMatrix[0], 64);
  assert.equal(left.fingers.little.raw[0], 30);
  const originalRaw = left.pressure[18];
  left.fingers.thumb.raw[0] = 99;
  assert.equal(left.pressure[18], originalRaw);
  assert.equal(left.fingers.thumb.matrix[0][0], 18);
});
