/**
 * 触觉足底：130 字节首包 + 146 字节尾包，各带 AA 55 03 99 帧尾。
 * byte[0] 是段号 1/2；byte[1] 为 3=左脚、4=右脚，首尾类型必须一致。
 * 交付全部 256 个原扫描 ADC、16 字节原始 IMU 和含帧尾的两份原包；不抽点或插值。
 */
import { ShroomError } from '../errors.js';
import { decodeFrame } from '../frame.js';
import { streamArray, streamInvalid, streamNumber, streamObject, streamOutput, streamPressureFields } from './stream-utils.js';

const tactileFootTail = [0xaa, 0x55, 0x03, 0x99];
const tactileFootFirstSize = 130;
const tactileFootSecondSize = 146;
const tactileFootPairTimeoutMs = 1000;
const tactileFootSideByType = Object.freeze({ 3: 'left', 4: 'right' });
const tactileFootProfile = Object.freeze({
  product: 'footVideo', label: '触觉足底', family: 'foot',
  baudRate: 921600, payloadLength: tactileFootFirstSize + tactileFootSecondSize,
  sensorPoints: 256, rows: 16, cols: 16,
  firstPacketLength: tactileFootFirstSize, secondPacketLength: tactileFootSecondSize,
});

function validateTactileFootOptions(options, invalid) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !['left', 'right', 'auto'].includes(options.side ?? 'auto') || options.side === null) {
    invalid('side', '触觉足底的 side 可省略，或设置为 left、right、auto；包类型 3/4 始终决定左右脚。');
  }
}

function createTactileFootFrame(first, second, side) {
  const pressure = new Uint8Array(256);
  pressure.set(first.subarray(2, tactileFootFirstSize));
  pressure.set(second.subarray(2, 130), 128);
  return {
    // 16×16 仅为扫描存储形状；归一化值和统计量不代表物理鞋形或标定压力。
    ...decodeFrame(pressure, { rows: 16, cols: 16 }),
    product: tactileFootProfile.product, protocol: 'segmented', side, packetType: first[1],
    pressure, pressureMatrix: pressure.slice(),
    imu: { raw: second.slice(130, tactileFootSecondSize) },
    rawPackets: [first, second],
  };
}

function createTactileFootParser(options = {}) {
  validateTactileFootOptions(options, (field, message) => {
    throw new ShroomError('INVALID_CONFIG', message, { stage: 'configure', details: { field } });
  });
  const side = options.side ?? 'auto';
  // 固定上限：即使输入长时间没有分隔符，也不保留整块输入。
  const buffer = new Uint8Array(tactileFootSecondSize + tactileFootTail.length);
  let first = null, used = 0, overflow = false, dropped = 0, frameLength = 0;

  function discardFirst() {
    if (first) { first = null; dropped += 1; }
  }
  function expireFirst(now) {
    if (first && (now < first.receivedAt || now - first.receivedAt > tactileFootPairTimeoutMs)) discardFirst();
  }
  function processPacket(length, now) {
    if (length === 1 && buffer[0] === 3) { discardFirst(); return null; }
    if (!((length === tactileFootFirstSize && buffer[0] === 1) || (length === tactileFootSecondSize && buffer[0] === 2))) {
      discardFirst(); dropped += 1; return null;
    }
    const packetType = buffer[1];
    const outputSide = tactileFootSideByType[packetType];
    // 显式 side 是筛选条件，不能把右脚的原包重新标成左脚。
    if (!outputSide || (side !== 'auto' && outputSide !== side)) {
      discardFirst(); dropped += 1; return null;
    }
    if (length === tactileFootFirstSize) {
      discardFirst();
      first = { raw: buffer.slice(0, tactileFootFirstSize + tactileFootTail.length), packetType, receivedAt: now };
      return null;
    }
    const head = first;
    first = null; // 尾包消费缓存一次，孤立/重复/跨类型尾包不能发布。
    if (!head || head.packetType !== packetType) { dropped += 1; return null; }
    frameLength = tactileFootFirstSize + tactileFootSecondSize;
    return createTactileFootFrame(head.raw, buffer.slice(0, tactileFootSecondSize + tactileFootTail.length), outputSide);
  }

  return {
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) {
        throw new ShroomError('PARSE_FAILED', '触觉足底分包输入必须是 Uint8Array 字节。', { stage: 'parse' });
      }
      const frames = [];
      expireFirst(Date.now());
      for (const byte of chunk) {
        if (used === buffer.length) {
          overflow = true;
          discardFirst();
          buffer.copyWithin(0, used - (tactileFootTail.length - 1), used);
          used = tactileFootTail.length - 1;
        }
        buffer[used++] = byte;
        if (used < tactileFootTail.length || !tactileFootTail.every((value, i) => buffer[used - tactileFootTail.length + i] === value)) continue;
        const now = Date.now();
        expireFirst(now);
        if (overflow) dropped += 1;
        else if (used > tactileFootTail.length) {
          const frame = processPacket(used - tactileFootTail.length, now);
          if (frame) frames.push(frame);
        } else discardFirst();
        used = 0;
        overflow = false;
      }
      return frames;
    },
    reset() { used = 0; overflow = false; first = null; dropped = 0; frameLength = 0; },
    get droppedCount() { return dropped; },
    get frameLength() { return frameLength; },
  };
}

function tactileFootEqualValues(actual, expected, field) {
  if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i])) streamInvalid(field);
}

function readTactileFootPacket(value, field, length, segment, packetType) {
  const packet = streamArray(value, field, { max: length + tactileFootTail.length, byte: true });
  if (packet.length !== length + tactileFootTail.length || packet[0] !== segment || packet[1] !== packetType
    || !tactileFootTail.every((byte, i) => packet[length + i] === byte)) streamInvalid(field);
  return packet;
}

function readTactileFootStreamFields(input, output, typed) {
  streamPressureFields(input, output, typed);
  if (output.rows !== 16 || output.cols !== 16 || output.raw.length !== 256) streamInvalid('footVideo.shape');
  if (input.protocol !== 'segmented') streamInvalid('protocol');
  if (Object.hasOwn(input, 'sequence')) streamInvalid('sequence');
  const packetType = streamNumber(input.packetType, 'packetType', 3, 4, true);
  if (input.side !== tactileFootSideByType[packetType]) streamInvalid('side/packetType');
  tactileFootEqualValues(output.pressureMatrix, output.raw, 'pressureMatrix/raw');
  tactileFootEqualValues(output.values, Array.from(output.raw, value => Math.fround(value / 255)), 'values/raw');
  for (const field of ['min', 'max', 'avg']) streamNumber(output[field], field, 0, 1);

  streamObject(input.imu, 'imu');
  const imu = streamArray(input.imu.raw, 'imu.raw', { max: 16, byte: true });
  if (imu.length !== 16) streamInvalid('imu.raw.length');
  if (!Array.isArray(input.rawPackets) || input.rawPackets.length !== 2) streamInvalid('rawPackets');
  const first = readTactileFootPacket(input.rawPackets[0], 'rawPackets[0]', tactileFootFirstSize, 1, packetType);
  const second = readTactileFootPacket(input.rawPackets[1], 'rawPackets[1]', tactileFootSecondSize, 2, packetType);
  tactileFootEqualValues([...first.slice(2, tactileFootFirstSize), ...second.slice(2, 130)], output.raw, 'rawPackets/raw');
  tactileFootEqualValues(second.slice(130, tactileFootSecondSize), imu, 'rawPackets/imu.raw');

  output.protocol = 'segmented'; output.side = input.side; output.packetType = packetType;
  output.imu = { raw: streamOutput(imu, typed, Uint8Array) };
  output.rawPackets = [streamOutput(first, typed, Uint8Array), streamOutput(second, typed, Uint8Array)];
  return output;
}

export const tactileFootProductAdapter = Object.freeze({
  profile: tactileFootProfile,
  aliases: Object.freeze(['foot']),
  optionFields: Object.freeze(['side']),
  validateOptions: validateTactileFootOptions,
  connectionInfo: options => ['left', 'right'].includes(options.side)
    ? { side: options.side, protocol: 'segmented' } : { protocol: 'segmented' },
  discovery: Object.freeze({
    createParser: () => createTactileFootParser(),
    identify: frame => ({ side: frame.side, packetType: frame.packetType }),
  }),
  createParser: createTactileFootParser,
  readStreamFields: readTactileFootStreamFields,
});
