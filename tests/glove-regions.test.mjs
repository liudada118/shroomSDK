import assert from 'node:assert/strict';
import test from 'node:test';
import { createGloveRegions } from '../core/glove-regions.js';
import { ShroomError } from '../core/errors.js';

// Independent transcription of the supplied 1-based product mapping. Never
// derive expected results from the implementation's private lookup tables.
const expected = {
  left: {
    little: { name: '小拇指', indices: [[31, 30, 29], [15, 14, 13], [255, 254, 253], [239, 238, 237]], pulp: 222 },
    ring: { name: '无名指', indices: [[28, 27, 26], [12, 11, 10], [252, 251, 250], [236, 235, 234]], pulp: 219 },
    middle: { name: '中指', indices: [[25, 24, 23], [9, 8, 7], [249, 248, 247], [233, 232, 231]], pulp: 216 },
    index: { name: '食指', indices: [[22, 21, 20], [6, 5, 4], [246, 245, 244], [230, 229, 228]], pulp: 213 },
    thumb: { name: '大拇指', indices: [[19, 18, 17], [3, 2, 1], [243, 242, 241], [227, 226, 225]], pulp: 210 },
    palm: {
      name: '手掌',
      indices: [
        [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196],
        [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177],
        [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161],
        [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145],
        [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129],
      ],
    },
  },
  right: {
    thumb: { name: '大拇指', indices: [[240, 239, 238], [256, 255, 254], [16, 15, 14], [32, 31, 30]], pulp: 47 },
    index: { name: '食指', indices: [[237, 236, 235], [253, 252, 251], [13, 12, 11], [29, 28, 27]], pulp: 44 },
    middle: { name: '中指', indices: [[234, 233, 232], [250, 249, 248], [10, 9, 8], [26, 25, 24]], pulp: 41 },
    ring: { name: '无名指', indices: [[231, 230, 229], [247, 246, 245], [7, 6, 5], [23, 22, 21]], pulp: 38 },
    little: { name: '小拇指', indices: [[228, 227, 226], [244, 243, 242], [4, 3, 2], [20, 19, 18]], pulp: 35 },
    palm: {
      name: '手掌',
      indices: [
        [61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50],
        [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66],
        [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82],
        [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98],
        [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114],
      ],
    },
  },
};

function assertRegion(region, mapping, pressure, cols, fullScale = 255) {
  const positions = mapping.indices.flat().map((position) => position - 1);
  const raw = positions.map((position) => pressure[position]);
  assert.equal(region.name, mapping.name);
  assert.equal(region.rows, mapping.indices.length);
  assert.equal(region.cols, cols);
  assert.deepEqual(region.rowLengths, mapping.indices.map((row) => row.length));
  assert.ok(region.sourceIndices instanceof Uint16Array);
  assert.deepEqual(Array.from(region.sourceIndices), positions);
  assert.ok(region.raw instanceof Uint8Array);
  assert.deepEqual(Array.from(region.raw), raw);
  assert.ok(region.values instanceof Float32Array);
  assert.deepEqual(region.values, Float32Array.from(raw, (value) => value / fullScale));
  assert.deepEqual(region.matrix, mapping.indices.map((row) => row.map((position) => pressure[position - 1])));
}

for (const side of ['left', 'right']) {
  for (const key of ['thumb', 'index', 'middle', 'ring', 'little', 'palm']) {
    test(`${side} ${key}: all source indices and ADC/normalized values match the supplied mapping`, () => {
      const pressure = Uint8Array.from({ length: 256 }, (_, index) => index);
      const regions = createGloveRegions(pressure, { side });
      const region = key === 'palm' ? regions.palm : regions.fingers[key];
      const mapping = expected[side][key];
      assertRegion(region, mapping, pressure, key === 'palm' ? 15 : 3);
      if (key !== 'palm') {
        assertRegion(region.pulp, { name: `${mapping.name}指腹`, indices: [[mapping.pulp]] }, pressure, 1);
        assert.equal(region.raw.length, 12);
        assert.equal(region.pulp.raw.length, 1);
        assert.equal(region.sourceIndices.includes(region.pulp.sourceIndices[0]), false);
      }
    });
  }
}

test('1-based endpoints 1 and 256 map to scan bytes 0 and 255 without truncation', () => {
  const pressure = new Uint8Array(256);
  pressure[0] = 19;
  pressure[255] = 241;
  const left = createGloveRegions(pressure, { side: 'left' });
  const right = createGloveRegions(pressure, { side: 'right' });
  assert.equal(left.fingers.thumb.sourceIndices[5], 0);
  assert.equal(left.fingers.thumb.raw[5], 19);
  assert.equal(right.fingers.thumb.sourceIndices[3], 255);
  assert.equal(right.fingers.thumb.raw[3], 241);
});

test('valid zero ADC points remain zero in body, pulp and palm data', () => {
  const pressure = new Uint8Array(256);
  for (const side of ['left', 'right']) {
    const { fingers, palm } = createGloveRegions(pressure, { side });
    for (const finger of Object.values(fingers)) {
      for (const region of [finger, finger.pulp]) {
        assert.ok(region.raw.every((value) => value === 0));
        assert.ok(region.values.every((value) => value === 0));
        assert.ok(region.matrix.flat().every((value) => value === 0));
      }
    }
    assert.equal(palm.raw.length, 72);
    assert.ok(palm.raw.every((value) => value === 0));
  }
});

test('ragged palms retain 72 real sensors, not a padded 75-cell rectangle', () => {
  for (const side of ['left', 'right']) {
    const { palm } = createGloveRegions(new Uint8Array(256).fill(7), { side });
    assert.equal(palm.rows, 5);
    assert.equal(palm.cols, 15);
    assert.deepEqual(palm.rowLengths, [12, 15, 15, 15, 15]);
    assert.deepEqual(palm.matrix.map((row) => row.length), [12, 15, 15, 15, 15]);
    assert.equal(palm.raw.length, 72);
    assert.equal(palm.sourceIndices.length, 72);
    assert.equal(palm.values.length, 72);
    assert.ok(palm.matrix.flat().every((value) => value === 7));
  }
});

test('custom fullScale normalizes every body, pulp and palm without changing ADC values', () => {
  const pressure = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const side of ['left', 'right']) {
    const regions = createGloveRegions(pressure, { side, fullScale: 100 });
    for (const key of ['thumb', 'index', 'middle', 'ring', 'little']) {
      const mapping = expected[side][key];
      assertRegion(regions.fingers[key], mapping, pressure, 3, 100);
      assertRegion(regions.fingers[key].pulp, { name: `${mapping.name}指腹`, indices: [[mapping.pulp]] }, pressure, 1, 100);
    }
    assertRegion(regions.palm, expected[side].palm, pressure, 15, 100);
  }
});

test('all region arrays are independent snapshots of input, sibling arrays, and subsequent frames', () => {
  const pressure = Uint8Array.from({ length: 256 }, (_, index) => index);
  const original = pressure.slice();
  const first = createGloveRegions(pressure, { side: 'left' });
  const pristine = createGloveRegions(pressure, { side: 'left' });
  const thumb = first.fingers.thumb;
  thumb.raw[0] = 251;
  assert.equal(thumb.matrix[0][0], pristine.fingers.thumb.matrix[0][0]);
  assert.equal(thumb.values[0], pristine.fingers.thumb.values[0]);
  thumb.matrix[0][1] = 250;
  assert.equal(thumb.raw[1], pristine.fingers.thumb.raw[1]);
  thumb.sourceIndices[0] = 255;
  thumb.rowLengths[0] = 99;
  thumb.pulp.raw[0] = 249;
  thumb.pulp.sourceIndices[0] = 0;
  first.palm.matrix[0][0] = 248;
  first.palm.raw[1] = 247;
  assert.deepEqual(pressure, original);
  assert.deepEqual(first.fingers.index, pristine.fingers.index);
  assert.deepEqual(createGloveRegions(pressure, { side: 'left' }), pristine);
  pressure.fill(0);
  assert.equal(pristine.fingers.thumb.raw[0], original[18]);
  assert.equal(pristine.palm.matrix[0][0], original[206]);
});

test('right-hand results cannot mutate left-hand results or private mapping tables', () => {
  const pressure = new Uint8Array(256).fill(127);
  const left = createGloveRegions(pressure, { side: 'left' });
  const right = createGloveRegions(pressure, { side: 'right' });
  const baselineRight = createGloveRegions(pressure, { side: 'right' });
  left.fingers.thumb.sourceIndices.fill(0);
  left.fingers.thumb.pulp.sourceIndices.fill(0);
  left.palm.sourceIndices.fill(0);
  left.palm.matrix[0].fill(0);
  assert.deepEqual(right, baselineRight);
  assert.deepEqual(createGloveRegions(pressure, { side: 'right' }), baselineRight);
});

test('requires an explicit supported side and object configuration', () => {
  const pressure = new Uint8Array(256);
  for (const options of [undefined, null, [], 'left', {}, { side: 'LEFT' }, { side: 'auto' }, { side: 0 }]) {
    assert.throws(() => createGloveRegions(pressure, options), (error) => error instanceof ShroomError
      && error.code === 'INVALID_CONFIG' && error.stage === 'configure' && error.details.field === 'side');
  }
});

test('requires exactly 256 Uint8Array scan bytes', () => {
  for (const pressure of [null, undefined, [], new Array(256).fill(0), new Uint16Array(256), new Uint8Array(255), new Uint8Array(257), '0'.repeat(256)]) {
    assert.throws(() => createGloveRegions(pressure, { side: 'left' }), (error) => error instanceof ShroomError
      && error.code === 'PARSE_FAILED' && error.stage === 'parse');
  }
});

test('fullScale uses the shared finite positive configuration validation', () => {
  for (const fullScale of [0, -1, NaN, Infinity, -Infinity, '255', null]) {
    assert.throws(() => createGloveRegions(new Uint8Array(256), { side: 'left', fullScale }), (error) => error instanceof ShroomError
      && error.code === 'INVALID_CONFIG' && error.stage === 'configure' && error.details.field === 'fullScale');
  }
});
