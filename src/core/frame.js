/**
 * 帧解码：把一帧原始字节变成统一的 Frame 对象。
 *
 * Web Serial / Node 串口 / 模拟源共用这一基础结构；产品层在其上增加
 * pressure、fingers、palm、imu 等产品字段，不在本通用解码器中推断产品。
 *
 * Frame {
 *   raw       Uint8Array   原始 ADC 值，0~255，一个点一个字节
 *   values    Float32Array ADC / fullScale，默认满量程 255 时为 0~1，长度 = rows * cols
 *   rows, cols             矩阵尺寸
 *   min, max, avg          归一化后的极值与均值
 *   area                   有效点数（超过阈值的点）
 *   center    {x, y}       压力重心，0~1
 *   timestamp              毫秒时间戳
 * }
 *
 * 说明：默认按「1 字节 = 1 个点」解析，方阵推断行列（1024 → 32×32）。
 * 如果你的设备不是这个规格，用 options.rows / options.cols 显式指定。
 * fullScale 用于相对归一化，结果不截断，也不等于标定后的物理压力。
 *
 * 另外注意：字节的先后顺序是采集板的扫描顺序，不等于垫子上的位置。
 * 要让画面和手指位置对上，用 options.layout 选一个点位排列（见 core/layout.js）。
 */

import { getLayout } from './layout.js';
import { ShroomError } from './errors.js';
import { validateDecodeOptions, MAX_MATRIX_POINTS } from './serial-config.js';

/** 优先使用成对传入的 rows / cols；否则由点数推断方阵，非完全平方数返回单行。 */
export function resolveShape(points, options = {}) {
  validateDecodeOptions(options);
  if (!Number.isSafeInteger(points) || points < 0 || points > MAX_MATRIX_POINTS) {
    throw new ShroomError('INVALID_CONFIG', '点数必须是有效范围内的非负整数', { stage: 'configure', details: { field: 'points' } });
  }
  if (options.rows && options.cols) {
    return { rows: options.rows, cols: options.cols };
  }
  const side = Math.round(Math.sqrt(points));
  if (side * side === points) return { rows: side, cols: side };
  return { rows: 1, cols: points };
}

/**
 * @param {Uint8Array} payload 一帧的原始字节（不含分隔符）
 * @param {object} [options] 通用解码配置；未指定线序时保持扫描顺序。
 * @param {number} [options.rows]      指定行数
 * @param {number} [options.cols]      指定列数
 * @param {number} [options.points]    只取前 N 个字节，默认取全部
 * @param {number} [options.fullScale] 相对归一化除数，必须大于 0，默认 255，不裁剪结果
 * @param {number} [options.threshold] 有效点阈值（归一化后），默认 0.02
 * @param {string} [options.layout]    点位排列，'raw'（默认）或排列名，见 core/layout.js
 * @returns {object} 基础 Frame；raw 是输入载荷的视图，values 是新分配的映射数组。
 */
export function decodeFrame(payload, options = {}) {
  options = validateDecodeOptions(options);
  if (!(payload instanceof Uint8Array)) throw new ShroomError('PARSE_FAILED', '解码输入必须是 Uint8Array 字节数据', { stage: 'parse' });
  if (payload.length > MAX_MATRIX_POINTS) throw new ShroomError('PARSE_FAILED', '输入帧超过最大点数限制', { stage: 'parse' });
  const fullScale = options.fullScale ?? 255;
  const threshold = options.threshold ?? 0.02;
  const points = Math.min(options.points ?? payload.length, payload.length);

  // 选了排列就以排列的行列为准：它知道这块垫子实际是几行几列，
  // 比如 car10 是从 1024 个扫描点里取 10×10，输出就是 10×10 而不是 32×32
  const layout = getLayout(options.layout);
  const { rows, cols } = layout ?? resolveShape(points, options);
  const size = rows * cols;

  // raw 保留输入视图供底层追溯；调用方若要跨帧持有且输入缓冲区会复用，应自行复制。
  const raw = payload.subarray(0, points);
  const values = new Float32Array(size);

  let min = Infinity;
  let max = 0;
  let sum = 0;
  let area = 0;
  let weight = 0;
  let cx = 0;
  let cy = 0;

  // perm 为 null 时按扫描顺序原样铺；给了排列就按排列取，
  // 这样 center / area 这些也是按垫子实际位置算的，不用调用方再修一遍。
  // perm 里的 -1 表示这个位置没有传感器，固定给 0
  const perm = layout ? layout.perm : null;

  for (let i = 0; i < size; i += 1) {
    const src = perm ? perm[i] : i;
    const v = src >= 0 && src < points ? raw[src] / fullScale : 0;
    values[i] = v;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > threshold) {
      area += 1;
      weight += v;
      cx += (i % cols) * v;
      cy += Math.floor(i / cols) * v;
    }
  }

  return {
    raw,
    values,
    rows,
    cols,
    min: min === Infinity ? 0 : min,
    max,
    avg: size > 0 ? sum / size : 0,
    area,
    // 只用超过阈值的点计算加权重心；没有有效点时返回几何中心。
    center: weight > 0
      ? { x: cx / weight / Math.max(1, cols - 1), y: cy / weight / Math.max(1, rows - 1) }
      : { x: 0.5, y: 0.5 },
    timestamp: Date.now(),
  };
}
