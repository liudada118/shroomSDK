import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductMockDevice, createMockDevice } from '../src/core/mock.js';
import { encodeStreamFrame, decodeStreamFrame } from '../src/core/stream-codec.js';

function nextFrame(device) {
  return new Promise((resolve, reject) => {
    let remove = () => {};
    const timeout = setTimeout(() => { remove(); reject(new Error('模拟帧超时')); }, 2000);
    remove = device.onFrame(frame => { clearTimeout(timeout); remove(); resolve(frame); });
  });
}

for (const side of ['left', 'right']) test(`internal ${side} glove mock traverses segmented parser and preserves protocol fields`, async t => {
  const device = createProductMockDevice({ product: 'glove', side });
  t.after(() => device.close());
  const frame = await nextFrame(device);
  assert.equal(device.info.product, 'handGloveSegmented');
  assert.equal(frame.product, 'handGloveSegmented');
  assert.equal(frame.protocol, 'segmented');
  assert.equal(frame.packetType, 2, '相同包类型必须可按显式左右手映射，不能从类型推断手侧');
  assert.equal(frame.side, side);
  assert.equal('sequence' in frame, false);
  assert.equal(frame.raw.length, 256);
  assert.equal(frame.palm.raw.length, 72);
  assert.equal(frame.imu.raw.length, 16);
  assert.equal(device.frameLength, 276);
  const copy = decodeStreamFrame(encodeStreamFrame(frame));
  assert.deepEqual(copy.raw, frame.raw);
  assert.equal('sequence' in copy, false);
  await device.close();
  assert.equal(device.state, 'closed');
});

test('legacy full-packet mock remains explicit; generic mock and unsupported products are not mislabeled', async t => {
  const legacy = createProductMockDevice({ product: 'handGloveFullPacket', side: 'left' });
  const generic = createMockDevice({ rows: 4, cols: 4 });
  t.after(async () => { await legacy.close(); await generic.close(); });
  const [full, raw] = await Promise.all([nextFrame(legacy), nextFrame(generic)]);
  assert.equal(full.product, 'handGloveFullPacket');
  assert.equal(typeof full.sequence, 'number');
  assert.equal(raw.product, undefined);
  assert.equal(raw.raw.length, 16);
  assert.throws(() => createProductMockDevice({ product: 'body' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => createProductMockDevice({ product: 'insole', side: 'left' }), { code: 'INVALID_CONFIG' });
});
