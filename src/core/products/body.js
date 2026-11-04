/** 人体全身适配器：保留全部扫描字节，并按十块物理源矩阵提取 400 点。 */
import { ShroomError } from '../errors.js';
import { decodeFrame } from '../frame.js';
import { createTailProductParser } from './tail-parser.js';
import { humanBodyRegionLayouts } from './body-layout.js';
import { streamInvalid, streamObject, streamNumber, streamArray, streamOutput, streamPressureFields } from './stream-utils.js';

const bodyProductProfile = Object.freeze({
  product: 'humanBody', label: '人体全身', family: 'body',
  baudRate: 1000000, payloadLength: 1024, sensorPoints: 1024,
  mappedSensorPoints: 400, rows: 32, cols: 32,
});

/** 人体没有手侧选择；左右区域随整帧一起输出，不据此猜测安装朝向。 */
function validateBodyProductOptions(options, invalid) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('options', '人体产品解析参数必须是对象。');
  if ('side' in options) invalid('side', '人体全身不接受 side 参数，十个源矩阵随整帧一起返回。');
}

/** 每帧新建区域快照，矩阵和 raw 均保留 ADC 原值，values 只做除以 255 的归一化。 */
function buildHumanBodyRegions(payload) {
  const regions = {};
  for (const [key, layout] of Object.entries(humanBodyRegionLayouts)) {
    const sourceIndices = Uint16Array.from(layout.sourceIndices);
    const raw = Uint8Array.from(sourceIndices, (index) => payload[index]);
    const values = Float32Array.from(raw, (value) => value / 255);
    const matrix = Array.from({ length: layout.rows }, (_, row) => Array.from(raw.subarray(row * layout.cols, (row + 1) * layout.cols)));
    regions[key] = { name: layout.name, rows: layout.rows, cols: layout.cols, sourceIndices, raw, values, matrix };
  }
  return regions;
}

/** 固定 1024 字节 + AA 55 03 99 帧尾；32×32 仅表示扫描存储形状，不是人体展开图。 */
function createBodyProductParser(options = {}) {
  validateBodyProductOptions(options, (field, message) => {
    throw new ShroomError('INVALID_CONFIG', message, { stage: 'configure', details: { field } });
  });
  return createTailProductParser({
    payloadLength: bodyProductProfile.payloadLength,
    delimiter: [0xaa, 0x55, 0x03, 0x99],
    decodePayload(payload) {
      const frame = decodeFrame(payload, { rows: 32, cols: 32, layout: 'raw' });
      frame.product = bodyProductProfile.product;
      frame.pressure = frame.raw;
      frame.pressureMatrix = frame.raw.slice();
      frame.regions = buildHumanBodyRegions(frame.raw);
      return frame;
    },
  });
}

/** WS 中的线序必须与内置物理表完全相同，并逐点核对原始值、矩阵和归一化值。 */
function readHumanBodyStreamRegion(value, key, frameRaw, typed) {
  const field = `regions.${key}`;
  const layout = humanBodyRegionLayouts[key];
  const size = layout.sourceIndices.length;
  streamObject(value, field);
  if (value.name !== layout.name || value.rows !== layout.rows || value.cols !== layout.cols) streamInvalid(`${field}.shape`);
  const sourceIndices = streamArray(value.sourceIndices, `${field}.sourceIndices`, { max: size });
  const raw = streamArray(value.raw, `${field}.raw`, { max: size, byte: true });
  const values = streamArray(value.values, `${field}.values`, { max: size });
  if ([sourceIndices, raw, values].some((array) => array.length !== size)) streamInvalid(`${field}.length`);
  for (let i = 0; i < size; i += 1) {
    // 身体通道可到 1023，不能使用通用 index:true 的 0–255 限制或先转 Uint16 截断。
    const index = streamNumber(sourceIndices[i], `${field}.sourceIndices[${i}]`, 0, 1023, true);
    if (index !== layout.sourceIndices[i]) streamInvalid(`${field}.sourceIndices[${i}]`);
    if (raw[i] !== frameRaw[index]) streamInvalid(`${field}.raw[${i}]`);
    if (Math.fround(values[i]) !== Math.fround(raw[i] / 255)) streamInvalid(`${field}.values[${i}]`);
  }
  if (!Array.isArray(value.matrix) || value.matrix.length !== layout.rows) streamInvalid(`${field}.matrix`);
  const matrix = value.matrix.map((row, rowIndex) => {
    const result = streamArray(row, `${field}.matrix[${rowIndex}]`, { max: layout.cols, byte: true });
    if (result.length !== layout.cols || result.some((entry, col) => entry !== raw[rowIndex * layout.cols + col])) streamInvalid(`${field}.matrix[${rowIndex}]`);
    return result;
  });
  return {
    name: layout.name, rows: layout.rows, cols: layout.cols, matrix,
    sourceIndices: streamOutput(sourceIndices, typed, Uint16Array),
    raw: streamOutput(raw, typed, Uint8Array),
    values: streamOutput(values, typed, Float32Array),
  };
}

/** 白名单复制人体字段；完整扫描矩阵不得混入屏幕显示映射或裁剪后的数值。 */
function readBodyStreamFields(input, output, typed) {
  streamPressureFields(input, output, typed);
  if (input.product !== bodyProductProfile.product || output.rows !== 32 || output.cols !== 32
    || output.raw.length !== 1024 || output.values.length !== 1024) streamInvalid('humanBody.shape');
  if (output.pressureMatrix.some((value, i) => value !== output.raw[i])
    || output.values.some((value, i) => Math.fround(value) !== Math.fround(output.raw[i] / 255))) streamInvalid('humanBody.scanOrder');
  const regions = streamObject(input.regions, 'regions');
  const keys = Object.keys(humanBodyRegionLayouts);
  if (Object.keys(regions).length !== keys.length || keys.some((key) => !Object.hasOwn(regions, key))) streamInvalid('regions.keys');
  output.regions = {};
  for (const key of keys) output.regions[key] = readHumanBodyStreamRegion(regions[key], key, output.raw, typed);
  return output;
}

/** 连接接受 body 别名，输出只使用 humanBody；串口配置及所有身体线序均由适配器固定。 */
export const bodyProductAdapter = Object.freeze({
  profile: bodyProductProfile,
  aliases: Object.freeze(['body']),
  optionFields: Object.freeze([]),
  validateOptions: validateBodyProductOptions,
  connectionInfo: () => ({}),
  createParser: createBodyProductParser,
  readStreamFields: readBodyStreamFields,
});
