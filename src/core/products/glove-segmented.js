/**
 * 手套分包协议：130 字节首包 + 146 字节尾包，各带 AA 55 03 99 帧尾。
 * byte[0] 是段号 1/2，byte[1] 是配对类型（原始 0–255 字节），并非连续帧序号。
 * 与上位机手动连接一致，输出手侧按显式 side 选择，不根据配对类型推断实物。
 * 无 CRC 和真实序号，不能证明完整采样帧从未丢失；仅发布同连接、同类型的有效配对。
 */
import { ShroomError } from '../errors.js';
import { createGlovePressureFrame } from '../glove.js';
import { readGloveDataFields } from './glove.js';
import { streamInvalid, streamNumber } from './stream-utils.js';

const TAIL = [0xaa, 0x55, 0x03, 0x99];
const FIRST_SIZE = 130;
const SECOND_SIZE = 146;
const PAIR_TIMEOUT_MS = 1000;
const profile = Object.freeze({
  product: 'handGloveSegmented', label: '触觉手套（分包）', family: 'glove',
  baudRate: 921600, payloadLength: 276, sensorPoints: 256, rows: 13, cols: 15,
  firstPacketLength: FIRST_SIZE, secondPacketLength: SECOND_SIZE,
});

function validateOptions(options, invalid) {
  if (!options || !['left', 'right'].includes(options.side)) {
    invalid('side', '分包手套必须明确指定 side: left 或 right；该手侧用于本串口数据的线序映射。');
  }
}

function createParser(options = {}) {
  validateOptions(options, () => { throw new ShroomError('INVALID_CONFIG', '请选择有效的手套手侧。', { stage: 'configure' }); });
  const { side } = options;
  // 最大单包 146 + 4 字节；无论串口输入多大，解析器都不保留整块输入。
  const buffer = new Uint8Array(SECOND_SIZE + TAIL.length);
  // 每个连接对应一只手，只保留最新首包；新首包、错类型尾包都不能带过旧缓存。
  let first = null, used = 0, overflow = false, dropped = 0, frameLength = 0;

  function discardFirst() {
    if (first) { first = null; dropped += 1; }
  }
  function expireFirst(now) {
    if (first && (now < first.receivedAt || now - first.receivedAt > PAIR_TIMEOUT_MS)) discardFirst();
  }
  function processPacket(length, now) {
    if (length === 1 && buffer[0] === 3) { discardFirst(); return null; }
    if (!((length === FIRST_SIZE && buffer[0] === 1) || (length === SECOND_SIZE && buffer[0] === 2))) {
      discardFirst(); dropped += 1; return null;
    }
    const packetType = buffer[1];
    if (length === FIRST_SIZE) {
      discardFirst();
      first = { pressure: buffer.slice(2, FIRST_SIZE), packetType, receivedAt: now };
      return null;
    }
    const head = first;
    first = null; // 不论配对是否成功，尾包都消费缓存一次；孤立或重复尾包不能发布。
    if (!head || head.packetType !== packetType) { dropped += 1; return null; }
    const pressure = new Uint8Array(256);
    pressure.set(head.pressure);
    pressure.set(buffer.subarray(2, 130), 128);
    frameLength = FIRST_SIZE + SECOND_SIZE;
    return {
      ...createGlovePressureFrame(pressure, { side }),
      product: profile.product, protocol: 'segmented', side, packetType,
      // 保留原始 16 字节，不猜测四元数轴序、单位，也不伪造 sequence。
      imu: { raw: buffer.slice(130, SECOND_SIZE) },
    };
  }

  return {
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) throw new ShroomError('PARSE_FAILED', '手套分包输入必须是 Uint8Array 字节。', { stage: 'parse' });
      const frames = [];
      expireFirst(Date.now());
      for (const byte of chunk) {
        if (used === buffer.length) {
          // 超长段丢弃至下个帧尾，仅留最后 3 字节以识别跨 chunk 分隔符。
          overflow = true;
          discardFirst();
          buffer.copyWithin(0, used - (TAIL.length - 1), used);
          used = TAIL.length - 1;
        }
        buffer[used++] = byte;
        if (used < TAIL.length || !TAIL.every((value, i) => buffer[used - TAIL.length + i] === value)) continue;
        const now = Date.now();
        expireFirst(now);
        if (overflow) dropped += 1;
        else if (used > TAIL.length) {
          const frame = processPacket(used - TAIL.length, now);
          if (frame) frames.push(frame);
        }
        // 空帧尾也是边界；若位于首尾包之间，不能把首包带过未知数据段。
        else discardFirst();
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

function readStreamFields(input, output, typed) {
  readGloveDataFields(input, output, typed);
  if (input.protocol !== 'segmented') streamInvalid('protocol');
  if (Object.hasOwn(input, 'sequence')) streamInvalid('sequence');
  const packetType = streamNumber(input.packetType, 'packetType', 0, 255, true);
  output.protocol = 'segmented';
  output.packetType = packetType;
  return output;
}

export const segmentedGloveProductAdapter = Object.freeze({
  profile,
  aliases: Object.freeze(['glove']),
  optionFields: Object.freeze(['side']),
  validateOptions,
  connectionInfo: options => ({ side: options.side, protocol: 'segmented' }),
  createParser,
  readStreamFields,
});
