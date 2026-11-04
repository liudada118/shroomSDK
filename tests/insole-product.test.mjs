import test from 'node:test';
import assert from 'node:assert/strict';
import { insoleProductAdapter as adapter } from '../src/core/products/insole.js';
import { encodeStreamFrame, decodeStreamFrame } from '../src/core/stream-codec.js';

const magic = [0xaa, 0x55, 0x03, 0x99];
const concat = (...chunks) => Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk)));
const parserFor = (protocol = '12bit', side = 'left') => adapter.createParser({ protocol, side });

/** 构造已知的线上字节，不依赖产品解码器生成预期；包括 >255 ADC 和有符号 IMU。 */
function fixture(protocol = '12bit', sequence = 5, offset = 0) {
  const is12 = protocol === '12bit';
  const adcBytes = is12 ? 512 : 256;
  const payload = new Uint8Array(is12 ? 552 : 272);
  const view = new DataView(payload.buffer);
  const pressure = Array.from({ length: 256 }, (_, i) => (i * 17 + offset) % (is12 ? 4096 : 256));
  pressure[0] = 1; // 首 ADC 低字节为 1，不能误认成 8-bit packet type。
  pressure[1] = is12 ? 4095 : 255;
  for (let i = 0; i < 256; i++) {
    if (is12) view.setUint16(i * 2, pressure[i], true);
    else payload[i] = pressure[i];
  }
  const imu = [1, -0.25, 0.5, -0.125, -123.5, 0, 12.75, 9.8125, -2.25, 0.125];
  for (let i = 0; i < (is12 ? 10 : 4); i++) view.setFloat32(adcBytes + i * 4, imu[i], true);
  const packets = is12 ? [concat(magic, payload)] : [concat(magic, [1, sequence], payload.slice(0, 128)), concat(magic, [2, sequence], payload.slice(128))];
  return { pressure, payload, packets, wire: concat(...packets) };
}

test('insole requires explicit side and a supported protocol/baud, with independent default profile', () => {
  for (const options of [null, [], {}, { side: 'auto' }, { side: 'left', protocol: 'auto' },
    { side: 'left', protocol: {} }, { side: 'left', protocol: new String('12bit') },
    { side: 'left', baudRate: 1000000 }, { side: 'left', baudRate: '921600' }]) {
    assert.throws(() => adapter.createParser(options), { code: 'INVALID_CONFIG', stage: 'configure' });
  }
  assert.equal(adapter.profile.sensorPoints, 256);
  assert.equal(adapter.profile.mappedSensorPoints, 112);
  assert.equal(adapter.resolveProfile({ side: 'left' }).payloadLength, 552);
  for (const baudRate of [921600, 1500000, 3000000, 460800, 256000, 115200, 9600]) {
    assert.equal(adapter.resolveProfile({ side: 'right', protocol: '8bit', baudRate }).baudRate, baudRate);
  }
  assert.equal(adapter.resolveProfile({ side: 'right', protocol: '8bit' }).payloadLength, 272);
  assert.equal(adapter.profile.payloadLength, 552);
});

for (const protocol of ['12bit', '8bit']) {
  for (const side of ['left', 'right']) {
    test(`${protocol} ${side}: one-byte fragments and sticky frames preserve raw precision, IMU and A-layout`, () => {
      const parser = parserFor(protocol, side);
      const sample = fixture(protocol);
      const frames = [];
      for (const byte of concat([0, 9, 170], sample.wire, sample.wire)) frames.push(...parser.push(Uint8Array.of(byte)));
      assert.equal(frames.length, 2);
      assert.equal(parser.push(concat(sample.wire, sample.wire)).length, 2);
      const frame = frames[0];
      const is12 = protocol === '12bit';
      const Adc = is12 ? Uint16Array : Uint8Array;
      assert.equal(frame.product, 'jqInsole');
      assert.equal(frame.side, side);
      assert.equal(frame.protocol, protocol);
      assert.equal(frame.rows, 16); assert.equal(frame.cols, 16);
      assert.equal(frame.bitDepth, is12 ? 12 : 8);
      assert.equal(frame.fullScale, is12 ? 4095 : 255);
      assert.equal(parser.frameLength, is12 ? 552 : 272);
      assert.equal(frame.raw.length, is12 ? 512 : 256);
      assert.deepEqual(frame.raw, sample.payload.slice(0, frame.raw.length));
      assert.ok(frame.pressure instanceof Adc);
      assert.ok(frame.pressureMatrix instanceof Adc);
      assert.deepEqual([...frame.pressure], sample.pressure);
      assert.deepEqual(frame.pressureMatrix, frame.pressure);
      assert.equal(frame.values[1], 1);
      assert.equal(frame.values[2], Math.fround(sample.pressure[2] / frame.fullScale));
      assert.equal(frame.sequence, is12 ? undefined : 5);
      assert.equal(Object.hasOwn(frame, 'sequence'), !is12);
      assert.deepEqual([...frame.imu.quaternion], [1, -0.25, 0.5, -0.125]);
      assert.equal(frame.imu.raw.length, is12 ? 40 : 16);
      if (is12) {
        assert.deepEqual([...frame.imu.gyroscope], [-123.5, 0, 12.75]);
        assert.deepEqual([...frame.imu.acceleration], [9.8125, -2.25, 0.125]);
      } else {
        assert.equal(Object.hasOwn(frame.imu, 'gyroscope'), false);
        assert.equal(Object.hasOwn(frame.imu, 'acceleration'), false);
      }
      const sensors = frame.sensors;
      assert.equal(sensors.rows, 14); assert.equal(sensors.cols, 8);
      assert.equal(sensors.raw.length, 112);
      assert.ok(sensors.raw instanceof Adc);
      assert.ok(sensors.sourceIndices instanceof Uint16Array);
      assert.equal(new Set(sensors.sourceIndices).size, 112);
      const expectedIndices = Array.from({ length: 112 }, (_, i) => {
        const b = Math.floor(i / 8), dc = i % 8 + 1;
        return side === 'right' ? (8 - dc) * 16 + 2 + b : (dc + 7) * 16 + 13 - b;
      });
      assert.deepEqual([...sensors.sourceIndices], expectedIndices);
      assert.deepEqual([...sensors.raw], expectedIndices.map(index => sample.pressure[index]));
      assert.deepEqual([...sensors.values], expectedIndices.map(index => Math.fround(sample.pressure[index] / frame.fullScale)));
      assert.deepEqual(sensors.positions[0], { row: 0, col: 0, xMm: -14.2, yMm: -1.6 });
      assert.deepEqual(sensors.positions[104], { row: 13, col: 0, xMm: -13.7, yMm: -197.5 });
      assert.deepEqual(sensors.positions[111], { row: 13, col: 7, xMm: 21.6, yMm: -201.4 });
    });
  }
}

test('12-bit rejects overflow ADC and nonfinite IMU, then rescans inside the invalid candidate', () => {
  const sample = fixture();
  const badAdc = sample.wire.slice();
  new DataView(badAdc.buffer).setUint16(4, 4096, true);
  const badImu = sample.wire.slice();
  new DataView(badImu.buffer).setFloat32(516, NaN, true);
  const parser = parserFor();
  assert.equal(parser.push(concat(badAdc, badImu, sample.wire)).length, 1);
  assert.ok(parser.droppedCount >= 2);
  parser.reset();
  // 伪头后的 ADC 越界，但真正有效帧从偏移 17 开始，不能整段吞掉 556 字节。
  const recovered = parser.push(concat(magic, new Uint8Array(13).fill(255), sample.wire));
  assert.equal(recovered.length, 1);
  assert.deepEqual([...recovered[0].pressure], sample.pressure);
});

test('8-bit accepts only adjacent same-index pairs; stale, reversed and interleaved packets never combine', () => {
  const p = parserFor('8bit');
  const a = fixture('8bit', 255, 1), b = fixture('8bit', 0, 99);
  assert.deepEqual(p.push(concat(a.packets[1], a.packets[0], b.packets[0], a.packets[1], b.packets[1])), []);
  assert.deepEqual(p.push(concat(a.packets[0], [99], a.packets[1])), []);
  assert.deepEqual(p.push(concat(a.packets[0], magic, [3, 255], a.packets[1])), []);
  assert.equal(p.push(b.wire)[0].sequence, 0);
  const repeated = fixture('8bit', 7, 65), old = fixture('8bit', 7, 12);
  const [latest] = p.push(concat(old.packets[0], repeated.packets[0], repeated.packets[1]));
  assert.deepEqual([...latest.pressure], repeated.pressure);
  assert.ok(p.droppedCount > 0);
});

test('8-bit cached first segment expires and reset isolates parser sessions', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const p = parserFor('8bit');
  const sample = fixture('8bit');
  p.push(sample.packets[0]);
  t.mock.timers.tick(1001);
  assert.deepEqual(p.push(sample.packets[1]), []);
  assert.equal(p.push(sample.wire).length, 1);
  p.push(sample.packets[0]);
  p.reset();
  assert.equal(p.frameLength, 0); assert.equal(p.droppedCount, 0);
  assert.deepEqual(p.push(sample.packets[1]), []);
});

test('8-bit rejects nonfinite IMU and recovers without treating byte ADC as 12-bit data', () => {
  const sample = fixture('8bit');
  const bad = sample.packets[1].slice();
  new DataView(bad.buffer).setFloat32(134, Infinity, true);
  const p = parserFor('8bit');
  const frames = p.push(concat(sample.packets[0], bad, sample.wire));
  assert.equal(frames.length, 1);
  assert.equal(p.droppedCount, 1);
  assert.ok(frames[0].pressure instanceof Uint8Array);
});

for (const protocol of ['12bit', '8bit']) {
  test(`${protocol}: large noise, reset, bad input and independent snapshots`, () => {
    const p = parserFor(protocol);
    const sample = fixture(protocol);
    assert.deepEqual(p.push(new Uint8Array(1_000_000)), []);
    assert.throws(() => p.push([1, 2]), { code: 'PARSE_FAILED' });
    const [first, second] = p.push(concat(sample.wire, sample.wire));
    sample.wire.fill(255);
    first.raw.fill(0); first.pressure.fill(0); first.pressureMatrix.fill(0);
    first.values.fill(0); first.imu.raw.fill(0); first.imu.quaternion.fill(0);
    first.sensors.raw.fill(0); first.sensors.values.fill(0); first.sensors.sourceIndices.fill(0);
    first.sensors.positions[0].xMm = 999;
    assert.deepEqual([...second.pressure], sample.pressure);
    assert.equal(second.raw[0], 1);
    assert.equal(second.imu.quaternion[0], 1);
    assert.equal(second.sensors.positions[0].xMm, -14.2);
    assert.equal(p.push(fixture(protocol).wire)[0].sensors.positions[0].xMm, -14.2);
  });

  test(`${protocol}: JSON WS round-trip preserves every typed field, signed IMU and snapshots`, () => {
    const [frame] = parserFor(protocol).push(fixture(protocol).wire);
    const wire = encodeStreamFrame(frame);
    assert.ok(Array.isArray(wire.pressure));
    assert.ok(Array.isArray(wire.sensors.sourceIndices));
    const copy = decodeStreamFrame(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(copy, frame);
    if (protocol === '12bit') assert.equal(copy.pressure[1], 4095);
    wire.sensors.positions[0].xMm = 99;
    wire.imu.quaternion[0] = 99;
    assert.equal(copy.sensors.positions[0].xMm, -14.2);
    assert.equal(copy.imu.quaternion[0], 1);
    copy.sensors.sourceIndices[0] = 0;
    assert.notEqual(frame.sensors.sourceIndices[0], 0);
  });
}

test('WS validates all insole shapes, mapping consistency, ranges and protocol-specific fields', () => {
  const [frame] = parserFor().push(fixture().wire);
  const corruptions = [
    f => { f.protocol = 'auto'; }, f => { f.protocol = {}; }, f => { f.protocol = new String('12bit'); },
    f => { f.side = 'auto'; }, f => { f.bitDepth = 8; }, f => { f.fullScale = 255; },
    f => { f.rows = 8; }, f => { f.raw.pop(); }, f => { f.sequence = 1; },
    f => { f.pressure[0] = 4096; }, f => { f.pressure[0] = 1.5; },
    f => { f.pressure[0] = -1; }, f => { f.pressure.pop(); },
    f => { f.pressureMatrix[0] = 2; }, f => { f.values[0] = 2; },
    f => { f.sensors.rows = 28; }, f => { f.sensors.cols = 7; },
    f => { f.sensors.sourceIndices[0]++; }, f => { f.sensors.raw[0]++; },
    f => { f.sensors.raw[0] = Infinity; }, f => { f.sensors.values[0] = 0.1; },
    f => { f.sensors.positions.pop(); }, f => { f.sensors.positions[0].row = 14; },
    f => { f.sensors.positions[0].col = 8; }, f => { f.sensors.positions[0].xMm = NaN; },
    f => { f.sensors.positions[0].yMm = 1; }, f => { f.imu.raw.pop(); },
    f => { f.imu.quaternion.pop(); }, f => { f.imu.quaternion[0] = Infinity; },
    f => { f.imu.gyroscope[0] = 1e100; }, f => { f.imu.gyroscope[0] = 99; },
    f => { f.imu.acceleration.pop(); }, f => { f.imu.acceleration[1] = NaN; },
  ];
  for (const alter of corruptions) {
    const wire = encodeStreamFrame(frame);
    alter(wire);
    assert.throws(() => decodeStreamFrame(wire), { code: 'PARSE_FAILED' });
  }
  const [short] = parserFor('8bit').push(fixture('8bit').wire);
  for (const alter of [f => { delete f.sequence; }, f => { f.sequence = 256; },
    f => { f.imu.gyroscope = [0, 0, 0]; }, f => { f.imu.acceleration = [0, 0, 0]; }]) {
    const wire = encodeStreamFrame(short); alter(wire);
    assert.throws(() => decodeStreamFrame(wire), { code: 'PARSE_FAILED' });
  }
});

test('raw IEEE-754 signed zero survives JSON without quaternion normalization', () => {
  const sample = fixture();
  const dv = new DataView(sample.wire.buffer);
  dv.setFloat32(516, 2, true); // 明确不把非单位四元数悄悄归一化。
  dv.setFloat32(520, -0, true);
  const [frame] = parserFor().push(sample.wire);
  const copy = decodeStreamFrame(JSON.parse(JSON.stringify(encodeStreamFrame(frame))));
  assert.equal(copy.imu.quaternion[0], 2);
  assert.ok(Object.is(copy.imu.quaternion[1], -0));
});
