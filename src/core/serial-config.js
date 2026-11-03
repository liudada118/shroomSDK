/** 串口、通用解码和模拟源共用的参数校验；在分配缓冲区或打开硬件前拒绝无效配置。 */
import { ShroomError } from './errors.js';

// 限制单帧和矩阵的最大点数，避免错误配置造成过大的内存分配。
export const MAX_MATRIX_POINTS = 1048576;

function serialConfigObject(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ShroomError('INVALID_CONFIG', '配置必须是一个对象', { stage: 'configure' });
  }
  return options;
}

function serialConfigInvalid(field, expected) {
  throw new ShroomError('INVALID_CONFIG', `${field} ${expected}`, {
    stage: 'configure', details: { field }, suggestion: `修正 ${field}：${expected}。`,
  });
}

/** 未提供的可选字段交给调用层取默认值；已提供的值必须满足数值范围与整数约束。 */
function serialConfigNumber(options, field, { min = 0, max = Infinity, integer = false, exclusive = false } = {}) {
  const value = options[field];
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))
    || (exclusive ? value <= min : value < min) || value > max) {
    serialConfigInvalid(field, `必须是${integer ? '整数' : '有限数值'}，范围${exclusive ? '大于' : '不小于'} ${min}${max < Infinity ? ` 且不大于 ${max}` : ''}`);
  }
}

/** 校验分隔符与帧长区间；返回浅拷贝，并复制 delimiter，避免调用方随后改动原数组。 */
export function validateFramerOptions(options = {}) {
  serialConfigObject(options);
  serialConfigNumber(options, 'minLength', { integer: true, max: MAX_MATRIX_POINTS });
  serialConfigNumber(options, 'maxLength', { min: 1, integer: true, max: MAX_MATRIX_POINTS });
  if ((options.minLength ?? 8) > (options.maxLength ?? 8192)) serialConfigInvalid('minLength', '不能大于 maxLength');
  if (options.lockLength !== undefined && typeof options.lockLength !== 'boolean') serialConfigInvalid('lockLength', '必须是布尔值');
  if (options.delimiter !== undefined) {
    const value = options.delimiter;
    if ((!Array.isArray(value) && !(ArrayBuffer.isView(value) && typeof value[Symbol.iterator] === 'function'))
      || value.length < 1 || value.length > 64
      || !Array.from(value).every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      serialConfigInvalid('delimiter', '必须包含 1 至 64 个 0 到 255 的字节');
    }
  }
  return { ...options, ...(options.delimiter === undefined ? {} : { delimiter: Array.from(options.delimiter) }) };
}

/** 校验矩阵尺寸、满量程和阈值；rows / cols 必须成对出现，返回配置浅拷贝。 */
export function validateDecodeOptions(options = {}) {
  serialConfigObject(options);
  for (const field of ['rows', 'cols']) serialConfigNumber(options, field, { min: 1, integer: true, max: MAX_MATRIX_POINTS });
  if ((options.rows === undefined) !== (options.cols === undefined)) serialConfigInvalid('rows / cols', '必须同时指定');
  if (options.rows !== undefined && options.rows * options.cols > MAX_MATRIX_POINTS) serialConfigInvalid('rows / cols', `矩阵总点数不能超过 ${MAX_MATRIX_POINTS}`);
  serialConfigNumber(options, 'points', { integer: true, max: MAX_MATRIX_POINTS });
  serialConfigNumber(options, 'fullScale', { min: 0, exclusive: true });
  serialConfigNumber(options, 'threshold');
  if (options.layout !== undefined && typeof options.layout !== 'string') serialConfigInvalid('layout', '必须是排列名称字符串');
  // 未知排列名仍按文档约定回退到原扫描顺序；此处不根据名字推测产品。
  return { ...options };
}

/** 串口入口的组合校验：解码参数 → 分帧参数 → 波特率与路径；不查询实际端口。 */
export function validateSerialOptions(options = {}) {
  const result = validateFramerOptions(validateDecodeOptions(options));
  serialConfigNumber(result, 'baudRate', { min: 1, integer: true });
  if (result.path !== undefined && (typeof result.path !== 'string' || !result.path.trim())) serialConfigInvalid('path', '必须是非空端口路径');
  return result;
}

/** 校验模拟矩阵与帧率；帧率上下限同时保证 JavaScript 定时器的毫秒间隔有效。 */
export function validateMockOptions(options = {}) {
  const result = validateDecodeOptions(options);
  // 定时器延迟使用有符号 32 位毫秒；过低帧率会让延迟溢出并退化为约 1 ms。
  serialConfigNumber(result, 'fps', { min: 1000 / 2147483647, max: 1000 });
  return result;
}
