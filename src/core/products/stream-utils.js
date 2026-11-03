/** 产品适配器和 WS 编解码器共用的字段校验；不引用注册表，避免循环依赖。 */
import { ShroomError } from '../errors.js';

export const STREAM_FRAME_MAX_POINTS = 16384;

/** 在分配类型数组和绘图前拒绝无效输入，保留可定位的字段名。 */
export function streamInvalid(field) {
  throw new ShroomError('PARSE_FAILED', `数据帧字段无效：${field}`, {
    stage: 'parse', details: { field },
    suggestion: '确认服务端与浏览器使用相同版本的 Shroom SDK 数据协议。',
  });
}

/** 后续逐字段构造结果，不直接展开未经验证的网络对象。 */
export function streamObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) streamInvalid(field);
  return value;
}

/** 不隐式转换字符串；排除 NaN、无穷值和超出范围的数值。 */
export function streamNumber(value, field, min = 0, max = Number.MAX_VALUE, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isSafeInteger(value))) streamInvalid(field);
  return value;
}

/** 限制长度并复制数值；字节/通道下标为 0–255 整数，浮点值不能溢出 Float32。 */
export function streamArray(value, field, { max = STREAM_FRAME_MAX_POINTS, byte = false, index = false } = {}) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || !Number.isSafeInteger(value.length)
    || value.length > max) streamInvalid(field);
  return Array.from(value, (entry) => {
    streamNumber(entry, field, 0, byte || index ? 255 : Number.MAX_VALUE, byte || index);
    if (!byte && !index && !Number.isFinite(Math.fround(entry))) streamInvalid(field);
    return entry;
  });
}

/** 编码返回普通数组；解码创建独立类型数组快照。 */
export function streamOutput(values, typed, Kind) {
  return typed ? Kind.from(values) : values;
}

/** 现有压力产品共用的扩展：原扫描压力必须等于 raw，映射 ADC 长度必须匹配矩阵。 */
export function streamPressureFields(input, output, typed) {
  const pressure = streamArray(input.pressure, 'pressure', { byte: true });
  const matrix = streamArray(input.pressureMatrix, 'pressureMatrix', { byte: true });
  if (pressure.length !== output.raw.length || pressure.some((value, i) => value !== output.raw[i])
    || matrix.length !== output.rows * output.cols) streamInvalid('pressure/pressureMatrix');
  output.product = input.product;
  output.pressure = typed ? output.raw : [...output.raw];
  output.pressureMatrix = streamOutput(matrix, typed, Uint8Array);
  return output;
}
