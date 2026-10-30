/**
 * WS 帧编解码：发送前把类型数组转成 JSON 数组，接收后校验结构并恢复独立类型数组。
 * 本模块只转换传输表示，不重新拆串口包、不二次映射点位，也不推断产品类型。
 */
import { getDeviceProductAdapter } from './products/registry.js';
import { STREAM_FRAME_MAX_POINTS, streamInvalid, streamObject, streamNumber, streamArray, streamOutput } from './products/stream-utils.js';

/** 独立 Node 服务和浏览器客户端共用的传输协议版本标识。 */
export const STREAM_SCHEMA = 'shroom.frame.v1';
export const MAX_STREAM_POINTS = STREAM_FRAME_MAX_POINTS;

/**
 * 校验并复制通用帧，产品扩展交给注册表中的适配器；typed 决定数组表示。
 * 不在传输层按产品写分支，新增协议也不能跳过公共帧大小及数值安全检查。
 */
function streamReadFrame(input, typed) {
  streamObject(input, 'frame');
  const rows = streamNumber(input.rows, 'rows', 0, MAX_STREAM_POINTS, true);
  const cols = streamNumber(input.cols, 'cols', 0, MAX_STREAM_POINTS, true);
  const size = rows * cols;
  if (size > MAX_STREAM_POINTS || ((rows === 0) !== (cols === 0))) streamInvalid('rows/cols');
  const raw = streamArray(input.raw, 'raw', { byte: true });
  const values = streamArray(input.values, 'values');
  if (values.length !== size) streamInvalid('values.length');
  streamObject(input.center, 'center');
  const output = {
    raw: streamOutput(raw, typed, Uint8Array),
    values: streamOutput(values, typed, Float32Array), rows, cols,
    min: streamNumber(input.min, 'min'), max: streamNumber(input.max, 'max'),
    avg: streamNumber(input.avg, 'avg'), area: streamNumber(input.area, 'area', 0, size, true),
    center: { x: streamNumber(input.center.x, 'center.x', 0, 1), y: streamNumber(input.center.y, 'center.y', 0, 1) },
    timestamp: streamNumber(input.timestamp, 'timestamp'),
  };
  if (output.min > output.max) streamInvalid('min/max');
  if (input.product === undefined) return output;
  const adapter = getDeviceProductAdapter(input.product, { allowAliases: false });
  if (!adapter) streamInvalid('product');
  return adapter.readStreamFields(input, output, typed);
}

/**
 * 把一帧转换为独立、可 JSON.stringify 的对象，所有数值数组均变为普通数组。
 * @param {object} frame 已解析的通用帧或产品帧；缺字段/形状不符时抛 PARSE_FAILED。
 * @returns {object} 校验后的 JSON 帧对象；这里只生成对象，不返回 JSON 字符串。
 */
export function encodeStreamFrame(frame) {
  return streamReadFrame(frame, false);
}

/**
 * 将 JSON.parse 后的帧对象恢复成类型数组快照，保留已有点位映射结果。
 * @param {object} frame 网络消息内的帧对象，而非完整 WS 信封或 JSON 字符串。
 * @returns {object} 可直接交付 onData 的帧；raw、values、分区数组按 SDK 类型恢复。
 */
export function decodeStreamFrame(frame) {
  return streamReadFrame(frame, true);
}
