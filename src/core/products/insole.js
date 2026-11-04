/** 鞋垫 A 版：显式协议与脚侧、原始 ADC/IMU、112 个真实点位及 WS 校验。 */
import { ShroomError } from '../errors.js';
import { createInsoleLayout } from './insole-layout.js';
import { streamInvalid, streamObject, streamNumber, streamOutput } from './stream-utils.js';

const INSOLE_MAGIC = [0xaa, 0x55, 0x03, 0x99];
const INSOLE_BAUD_RATES = [921600, 1500000, 3000000, 460800, 256000, 115200, 9600];
const INSOLE_SEGMENT_MAX_AGE_MS = 1000;
const INSOLE_PROTOCOLS = Object.freeze({
  '12bit': Object.freeze({ bitDepth: 12, fullScale: 4095, adcBytes: 512, imuBytes: 40, payloadLength: 552, Adc: Uint16Array }),
  '8bit': Object.freeze({ bitDepth: 8, fullScale: 255, adcBytes: 256, imuBytes: 16, payloadLength: 272, Adc: Uint8Array }),
});
const insoleProductProfile = Object.freeze({
  product: 'jqInsole', label: '鞋垫（A 版）', family: 'insole',
  baudRate: 921600, payloadLength: 552, sensorPoints: 256, mappedSensorPoints: 112, rows: 16, cols: 16,
});

function validateInsoleOptions(options, invalid) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('options', '鞋垫参数必须为对象。');
  if (!['left', 'right'].includes(options.side)) invalid('side', '鞋垫必须明确指定 side: left 或 right；协议没有可靠的脚侧标识。');
  if (options.protocol !== undefined && (typeof options.protocol !== 'string' || !Object.hasOwn(INSOLE_PROTOCOLS, options.protocol))) invalid('protocol', '鞋垫 protocol 必须为 12bit 或 8bit。');
  if (options.baudRate !== undefined && !INSOLE_BAUD_RATES.includes(options.baudRate)) invalid('baudRate', '请选择鞋垫支持的波特率：921600、1500000、3000000、460800、256000、115200 或 9600。');
}

function insoleConfigurationError(field, message) {
  throw new ShroomError('INVALID_CONFIG', message, { stage: 'configure', details: { field } });
}

/** 不归一化四元数、不融合姿态、不猜测单位；非有限浮点数使整个候选帧无效。 */
function decodeInsoleImu(raw, spec) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const components = new Float32Array(spec.imuBytes / 4);
  for (let i = 0; i < components.length; i++) {
    const value = dv.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) return null;
    components[i] = value;
  }
  return {
    raw,
    quaternion: components.slice(0, 4),
    ...(spec.imuBytes === 40 ? { gyroscope: components.slice(4, 7), acceleration: components.slice(7, 10) } : {}),
  };
}

/** 基础 Frame 的矩阵统计作用于 16×16 扫描顺序，不代表鞋形或物理足底重心。 */
function createInsoleScanFrame(raw, pressure, fullScale) {
  const values = new Float32Array(256);
  let min = Infinity, max = 0, sum = 0, area = 0, weight = 0, cx = 0, cy = 0;
  for (let i = 0; i < 256; i++) {
    const v = pressure[i] / fullScale;
    values[i] = v;
    min = Math.min(min, v); max = Math.max(max, v); sum += v;
    if (v > 0.02) {
      area++; weight += v; cx += (i % 16) * v; cy += Math.floor(i / 16) * v;
    }
  }
  return {
    raw, values, rows: 16, cols: 16, min, max, avg: sum / 256, area,
    center: weight ? { x: cx / weight / 15, y: cy / weight / 15 } : { x: 0.5, y: 0.5 },
    timestamp: Date.now(),
  };
}

function decodeInsolePayload(payload, side, protocol, sequence) {
  const spec = INSOLE_PROTOCOLS[protocol];
  const raw = payload.slice(0, spec.adcBytes);
  const pressure = new spec.Adc(256);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < 256; i++) {
    const value = spec.bitDepth === 12 ? dv.getUint16(i * 2, true) : raw[i];
    if (value > spec.fullScale) return null;
    pressure[i] = value;
  }
  const imu = decodeInsoleImu(payload.slice(spec.adcBytes), spec);
  if (!imu) return null;
  const layout = createInsoleLayout(side);
  const sensorRaw = spec.Adc.from(layout.sourceIndices, index => pressure[index]);
  return {
    ...createInsoleScanFrame(raw, pressure, spec.fullScale),
    product: 'jqInsole', side, protocol, bitDepth: spec.bitDepth, fullScale: spec.fullScale,
    ...(protocol === '8bit' ? { sequence } : {}),
    pressure, pressureMatrix: pressure.slice(), imu,
    sensors: { ...layout, raw: sensorRaw, values: Float32Array.from(sensorRaw, value => value / spec.fullScale) },
  };
}

/**
 * 固定 556 字节工作缓冲；每次只保留一个 128 字节首段。
 * 8-bit 仅接受 1 秒内相邻、同 index 的 type1→type2，不跨噪声/错序拼接历史缓存。
 */
function createInsoleParser(options = {}) {
  validateInsoleOptions(options, insoleConfigurationError);
  const { side, protocol = '12bit' } = options;
  const spec = INSOLE_PROTOCOLS[protocol];
  const buffer = new Uint8Array(556);
  let used = 0, firstSegment = null, dropped = 0, frameLength = 0;
  const clearSegment = () => {
    if (firstSegment) { dropped++; firstSegment = null; }
  };
  const discardPrefix = count => { buffer.copyWithin(0, count, used); used -= count; };
  const hasMagic = () => INSOLE_MAGIC.every((value, i) => buffer[i] === value);

  return {
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) throw new ShroomError('PARSE_FAILED', '鞋垫输入必须为 Uint8Array 字节。', { stage: 'parse' });
      const frames = [];
      const now = Date.now();
      if (firstSegment && (now - firstSegment.time > INSOLE_SEGMENT_MAX_AGE_MS || now < firstSegment.time)) clearSegment();
      for (const byte of chunk) {
        buffer[used++] = byte;
        // 逐字节重新对齐，最多留下 3 个可能属于下一同步头的字节。
        while (used >= 4 && !hasMagic()) { clearSegment(); discardPrefix(1); }
        if (used < 4) continue;
        if (protocol === '12bit') {
          if (used < 556) continue;
          const frame = decodeInsolePayload(buffer.slice(4, 556), side, protocol);
          if (frame) { frames.push(frame); frameLength = spec.payloadLength; used = 0; }
          else {
            dropped++;
            // 候选帧错误只前移一字节，保留其中可能存在的真正下一帧。
            discardPrefix(1);
            while (used >= 4 && !hasMagic()) discardPrefix(1);
          }
          continue;
        }
        if (used < 5) continue;
        const type = buffer[4];
        if (type !== 1 && type !== 2) { dropped++; clearSegment(); discardPrefix(1); continue; }
        const packetLength = type === 1 ? 134 : 150;
        if (used < packetLength) continue;
        const index = buffer[5];
        if (type === 1) {
          clearSegment();
          firstSegment = { index, payload: buffer.slice(6, 134), time: now };
        } else {
          const first = firstSegment;
          firstSegment = null; // 即使 index 不匹配，也不能让旧首段留待下次回绕。
          if (first && first.index === index && now - first.time <= INSOLE_SEGMENT_MAX_AGE_MS && now >= first.time) {
            const payload = new Uint8Array(272);
            payload.set(first.payload); payload.set(buffer.subarray(6, 150), 128);
            const frame = decodeInsolePayload(payload, side, protocol, index);
            if (frame) { frames.push(frame); frameLength = spec.payloadLength; }
            else dropped++;
          } else dropped++;
        }
        used = 0;
      }
      return frames;
    },
    reset() { used = 0; firstSegment = null; dropped = 0; frameLength = 0; },
    get droppedCount() { return dropped; },
    get frameLength() { return frameLength; },
  };
}

/** 独立数值校验：ADC 允许到 4095，IMU/坐标允许负数，绝不按 byte 截断。 */
function insoleNumbers(value, field, length, min, max, integer = false) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) streamInvalid(field);
  return Array.from(value, item => {
    streamNumber(item, field, min, max, integer);
    if (!integer && !Number.isFinite(Math.fround(item))) streamInvalid(field);
    return item;
  });
}

function insoleEqualValues(actual, expected, field) {
  if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i])) streamInvalid(field);
}

/** 发送/接收都逐字段校验，并核对原始字节、扫描 ADC、点位映射与 IMU 解码的一致性。 */
function readInsoleStreamFields(input, output, typed) {
  if (input.product !== 'jqInsole' || !['left', 'right'].includes(input.side)
    || typeof input.protocol !== 'string' || !Object.hasOwn(INSOLE_PROTOCOLS, input.protocol)) streamInvalid('insole.product/side/protocol');
  const spec = INSOLE_PROTOCOLS[input.protocol];
  if (input.bitDepth !== spec.bitDepth || input.fullScale !== spec.fullScale
    || output.rows !== 16 || output.cols !== 16 || output.raw.length !== spec.adcBytes) streamInvalid('insole.shape');
  const pressure = insoleNumbers(input.pressure, 'pressure', 256, 0, spec.fullScale, true);
  const matrix = insoleNumbers(input.pressureMatrix, 'pressureMatrix', 256, 0, spec.fullScale, true);
  const bytes = Uint8Array.from(output.raw);
  const dv = new DataView(bytes.buffer);
  const decoded = Array.from({ length: 256 }, (_, i) => spec.bitDepth === 12 ? dv.getUint16(i * 2, true) : bytes[i]);
  insoleEqualValues(pressure, decoded, 'pressure/raw');
  insoleEqualValues(matrix, pressure, 'pressureMatrix/pressure');
  insoleEqualValues(output.values, pressure.map(value => Math.fround(value / spec.fullScale)), 'values/pressure');
  for (const field of ['min', 'max', 'avg']) streamNumber(output[field], field, 0, 1);

  output.product = 'jqInsole'; output.side = input.side; output.protocol = input.protocol;
  output.bitDepth = spec.bitDepth; output.fullScale = spec.fullScale;
  if (input.protocol === '8bit') output.sequence = streamNumber(input.sequence, 'sequence', 0, 255, true);
  else if (input.sequence !== undefined) streamInvalid('sequence');
  output.pressure = streamOutput(pressure, typed, spec.Adc);
  output.pressureMatrix = streamOutput(matrix, typed, spec.Adc);

  const sensors = streamObject(input.sensors, 'sensors');
  const layout = createInsoleLayout(input.side);
  if (sensors.rows !== 14 || sensors.cols !== 8) streamInvalid('sensors.shape');
  const indices = insoleNumbers(sensors.sourceIndices, 'sensors.sourceIndices', 112, 0, 255, true);
  const sensorRaw = insoleNumbers(sensors.raw, 'sensors.raw', 112, 0, spec.fullScale, true);
  const sensorValues = insoleNumbers(sensors.values, 'sensors.values', 112, 0, 1);
  insoleEqualValues(indices, layout.sourceIndices, 'sensors.sourceIndices/layout');
  insoleEqualValues(sensorRaw, indices.map(index => pressure[index]), 'sensors.raw/pressure');
  insoleEqualValues(sensorValues, sensorRaw.map(value => Math.fround(value / spec.fullScale)), 'sensors.values/raw');
  if (!Array.isArray(sensors.positions) || sensors.positions.length !== 112) streamInvalid('sensors.positions');
  const positions = sensors.positions.map((position, i) => {
    streamObject(position, `sensors.positions[${i}]`);
    const expected = layout.positions[i];
    for (const field of ['row', 'col', 'xMm', 'yMm']) {
      if (position[field] !== expected[field]) streamInvalid(`sensors.positions[${i}].${field}`);
    }
    return { ...expected };
  });
  output.sensors = {
    rows: 14, cols: 8, positions,
    sourceIndices: streamOutput(indices, typed, Uint16Array),
    raw: streamOutput(sensorRaw, typed, spec.Adc), values: streamOutput(sensorValues, typed, Float32Array),
  };

  streamObject(input.imu, 'imu');
  const imuRaw = insoleNumbers(input.imu.raw, 'imu.raw', spec.imuBytes, 0, 255, true);
  const decodedImu = decodeInsoleImu(Uint8Array.from(imuRaw), spec);
  if (!decodedImu) streamInvalid('imu.raw');
  output.imu = { raw: streamOutput(imuRaw, typed, Uint8Array) };
  for (const field of ['quaternion', 'gyroscope', 'acceleration']) {
    const expected = decodedImu[field];
    if (!expected) { if (input.imu[field] !== undefined) streamInvalid(`imu.${field}`); continue; }
    const array = insoleNumbers(input.imu[field], `imu.${field}`, expected.length, -Number.MAX_VALUE, Number.MAX_VALUE);
    insoleEqualValues(array, expected, `imu.${field}/raw`);
    // JSON 会把 -0 写成 0；验证后按原始字节重建，保留 IEEE-754 的符号位。
    output.imu[field] = streamOutput(Array.from(expected), typed, Float32Array);
  }
  return output;
}

export const insoleProductAdapter = Object.freeze({
  profile: insoleProductProfile,
  aliases: Object.freeze(['insole']),
  optionFields: Object.freeze(['side', 'protocol', 'baudRate']),
  validateOptions: validateInsoleOptions,
  resolveProfile(options) {
    validateInsoleOptions(options, insoleConfigurationError);
    return { ...insoleProductProfile, baudRate: options.baudRate ?? 921600, payloadLength: INSOLE_PROTOCOLS[options.protocol ?? '12bit'].payloadLength };
  },
  connectionInfo(options) {
    const protocol = options.protocol ?? '12bit';
    const { bitDepth, fullScale } = INSOLE_PROTOCOLS[protocol];
    return { side: options.side, protocol, bitDepth, fullScale };
  },
  createParser: createInsoleParser,
  readStreamFields: readInsoleStreamFields,
});
