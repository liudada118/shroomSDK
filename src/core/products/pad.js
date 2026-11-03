/** 手部检测垫适配器：固定 1024 点协议、mat32 映射与压力帧校验。 */
import { decodeFrame } from '../frame.js';
import { createTailProductParser } from './tail-parser.js';
import { streamInvalid, streamPressureFields } from './stream-utils.js';

const padProductProfile = Object.freeze({
  product: 'hand', label: '手部检测垫', family: 'mat',
  baudRate: 1000000, payloadLength: 1024, sensorPoints: 1024, rows: 32, cols: 32,
});

function validatePadProductOptions(options, invalid) {
  if (options.side !== undefined) invalid('side', '手部检测垫不需要 side 参数。');
}

function createPadProductParser() {
  return createTailProductParser({
    payloadLength: padProductProfile.payloadLength,
    delimiter: [0xaa, 0x55, 0x03, 0x99],
    decodePayload(payload) {
      const frame = decodeFrame(payload, { layout: 'mat32' });
      frame.product = padProductProfile.product;
      frame.pressure = payload;
      // 单独保留映射后的 ADC；values 是归一化值，pressure 是原始扫描顺序。
      frame.pressureMatrix = Uint8Array.from(frame.values, (value) => Math.round(value * 255));
      return frame;
    },
  });
}

function readPadStreamFields(input, output, typed) {
  streamPressureFields(input, output, typed);
  if (output.rows !== 32 || output.cols !== 32 || output.raw.length !== 1024) streamInvalid('hand.shape');
  return output;
}

export const padProductAdapter = Object.freeze({
  profile: padProductProfile,
  aliases: Object.freeze(['pad']),
  // 允许省略或显式传 side: undefined；非空手侧仍按原接口规则拒绝。
  optionFields: Object.freeze(['side']),
  validateOptions: validatePadProductOptions,
  connectionInfo: () => ({}),
  createParser: createPadProductParser,
  readStreamFields: readPadStreamFields,
});
