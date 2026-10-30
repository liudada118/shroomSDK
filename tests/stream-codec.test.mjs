import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGlovePacket } from '../core/glove.js';
import { createProductParser } from '../core/product.js';
import { decodeFrame } from '../core/frame.js';
import { encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';

/** Make deterministic product data including zero and high-byte scan positions. */
function codecGlove(side = 'left') {
  const payload = Uint8Array.from({ length: 274 }, (_, i) => i & 255);
  return decodeGlovePacket(payload, { side });
}

for (const side of ['left', 'right']) {
  test(`codec round-trips ${side} glove, separate pulp, ragged palm and opaque IMU`, () => {
    const frame = codecGlove(side);
    const wire = encodeStreamFrame(frame);
    assert.equal(STREAM_SCHEMA, 'shroom.frame.v1');
    assert.ok(Array.isArray(wire.raw));
    assert.ok(Array.isArray(wire.fingers.index.sourceIndices));
    const copy = decodeStreamFrame(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(copy, frame);
    assert.equal(copy.pressure, copy.raw);
    assert.ok(copy.fingers.thumb.raw instanceof Uint8Array);
    assert.ok(copy.fingers.index.values instanceof Float32Array);
    assert.ok(copy.fingers.index.sourceIndices instanceof Uint16Array);
    assert.deepEqual(copy.palm.rowLengths, [12, 15, 15, 15, 15]);
    assert.equal(copy.palm.raw.length, 72);
    wire.fingers.index.raw[0] = 999;
    assert.notEqual(copy.fingers.index.raw[0], 999);
    copy.raw[0] = 99;
    assert.notEqual(frame.raw[0], 99);
  });
}

test('codec preserves hand pad mapping and generic matrix frames', () => {
  const parser = createProductParser('hand');
  const [frame] = parser.push(Uint8Array.from([...new Uint8Array(1024).fill(22), 170, 85, 3, 153]));
  assert.deepEqual(decodeStreamFrame(encodeStreamFrame(frame)), frame);
  for (const raw of [new Uint8Array(), Uint8Array.of(0, 127, 255, 12)]) {
    const plain = decodeFrame(raw);
    assert.deepEqual(decodeStreamFrame(encodeStreamFrame(plain)), plain);
  }
});

test('codec rejects shape corruption, byte wrapping, nonfinite data and oversized input', () => {
  const mutate = [
    (frame) => { frame.raw[0] = -1; },
    (frame) => { frame.rows = 1e9; },
    (frame) => { frame.values = []; },
    (frame) => { frame.values[0] = Infinity; },
    (frame) => { frame.values[0] = 1e100; },
    (frame) => { frame.center.x = 2; },
    (frame) => { frame.side = 'auto'; },
    (frame) => { frame.product = 'unknown'; },
    (frame) => { frame.palm.rowLengths = [15, 15, 15, 15, 15]; },
    (frame) => { frame.fingers.index.pulp.raw = []; },
    (frame) => { frame.fingers.thumb.sourceIndices[0] = 256; },
    (frame) => { frame.palm.matrix[0].push(0); },
    (frame) => { frame.imu.raw = new Array(17).fill(0); },
    (frame) => { frame.pressure[0] ^= 1; },
  ];
  for (const alter of mutate) {
    const frame = encodeStreamFrame(codecGlove());
    alter(frame);
    assert.throws(() => decodeStreamFrame(frame), { code: 'PARSE_FAILED' });
  }
  assert.throws(() => decodeStreamFrame(null), { code: 'PARSE_FAILED' });
  assert.throws(() => encodeStreamFrame(decodeFrame(new Uint8Array(16385))), { code: 'PARSE_FAILED' });
});

test('codec is an explicit allowlist and does not forward arbitrary application metadata', () => {
  const frame = codecGlove();
  frame.privateMetadata = { token: 'not-for-transport' };
  assert.equal(encodeStreamFrame(frame).privateMetadata, undefined);
});
