/** 整包触觉手套适配器：固定串口配置、左右手要求、协议解析与 WS 分区校验。 */
import { ShroomError } from '../errors.js';
import { decodeGlovePacket } from '../glove.js';
import { createTailProductParser } from './tail-parser.js';
import { streamInvalid, streamObject, streamNumber, streamArray, streamOutput, streamPressureFields } from './stream-utils.js';

const gloveProductProfile = Object.freeze({
  product: 'handGloveFullPacket', label: '触觉手套（整包）', family: 'glove',
  baudRate: 921600, payloadLength: 274, sensorPoints: 256, rows: 13, cols: 15,
});
const gloveStreamFingerKeys = ['thumb', 'index', 'middle', 'ring', 'little'];

/** 手侧必须由应用按实物明确指定，不能从包类型或串口猜测。 */
function validateGloveProductOptions(options, invalid) {
  if (!['left', 'right'].includes(options.side)) {
    invalid('side', '整包手套必须明确指定 side: left 或 right，不能根据串口或包类型猜测手侧。');
  }
}

function createGloveProductParser({ side } = {}) {
  validateGloveProductOptions({ side }, () => {
    throw new ShroomError('INVALID_CONFIG', '请选择有效的产品及手套手侧。', { stage: 'configure' });
  });
  return createTailProductParser({
    payloadLength: gloveProductProfile.payloadLength,
    delimiter: [0xaa, 0x55, 0x03, 0x99],
    decodePayload: (payload) => decodeGlovePacket(payload, { side }),
  });
}

/** 校验真实行长；手掌保留 72 点，不补成 5×15 的规则矩阵。 */
function gloveStreamRegion(value, field, typed, expectedRows) {
  streamObject(value, field);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64) streamInvalid(`${field}.name`);
  const rows = streamNumber(value.rows, `${field}.rows`, 1, 5, true);
  const cols = streamNumber(value.cols, `${field}.cols`, 1, 15, true);
  const rowLengths = streamArray(value.rowLengths, `${field}.rowLengths`, { max: 5, index: true });
  if (rows !== expectedRows.length || rowLengths.length !== rows
    || rowLengths.some((length, i) => length !== expectedRows[i])
    || cols !== Math.max(...expectedRows)) streamInvalid(`${field}.rowLengths`);
  const size = rowLengths.reduce((sum, length) => sum + length, 0);
  const raw = streamArray(value.raw, `${field}.raw`, { max: 75, byte: true });
  const values = streamArray(value.values, `${field}.values`, { max: 75 });
  const indices = streamArray(value.sourceIndices, `${field}.sourceIndices`, { max: 75, index: true });
  if ([raw, values, indices].some((array) => array.length !== size)) streamInvalid(`${field}.length`);
  if (!Array.isArray(value.matrix) || value.matrix.length !== rows) streamInvalid(`${field}.matrix`);
  const matrix = value.matrix.map((row, i) => {
    const result = streamArray(row, `${field}.matrix[${i}]`, { max: 15, byte: true });
    if (result.length !== rowLengths[i]) streamInvalid(`${field}.matrix[${i}]`);
    return result;
  });
  return {
    name: value.name, rows, cols, rowLengths, matrix,
    raw: streamOutput(raw, typed, Uint8Array),
    values: streamOutput(values, typed, Float32Array),
    sourceIndices: streamOutput(indices, typed, Uint16Array),
  };
}

/** 白名单复制手套字段；旧展示矩阵和标准五指/手掌分区分别验证。 */
function readGloveStreamFields(input, output, typed) {
  streamPressureFields(input, output, typed);
  if (output.rows !== 13 || output.cols !== 15 || output.raw.length !== 256) streamInvalid('glove.shape');
  if (!['left', 'right'].includes(input.side)) streamInvalid('side');
  output.side = input.side;
  output.sequence = streamNumber(input.sequence, 'sequence', 0, 255, true);
  output.packetType = streamNumber(input.packetType, 'packetType', 0, 255, true);
  streamObject(input.imu, 'imu');
  const imu = streamArray(input.imu.raw, 'imu.raw', { max: 16, byte: true });
  if (imu.length !== 16) streamInvalid('imu.raw.length');
  output.imu = { raw: streamOutput(imu, typed, Uint8Array) };
  streamObject(input.fingers, 'fingers');
  output.fingers = {};
  for (const key of gloveStreamFingerKeys) {
    const field = `fingers.${key}`;
    const finger = gloveStreamRegion(input.fingers[key], field, typed, [3, 3, 3, 3]);
    finger.pulp = gloveStreamRegion(input.fingers[key].pulp, `${field}.pulp`, typed, [1]);
    output.fingers[key] = finger;
  }
  output.palm = gloveStreamRegion(input.palm, 'palm', typed, [12, 15, 15, 15, 15]);
  return output;
}

/** 内部静态适配器；只有连接参数接受别名，输出帧始终使用 profile.product。 */
export const gloveProductAdapter = Object.freeze({
  profile: gloveProductProfile,
  aliases: Object.freeze(['glove']),
  optionFields: Object.freeze(['side']),
  validateOptions: validateGloveProductOptions,
  connectionInfo: (options) => ({ side: options.side }),
  createParser: createGloveProductParser,
  readStreamFields: readGloveStreamFields,
});
