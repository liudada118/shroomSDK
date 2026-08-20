/**
 * framePayload.js - 声明式帧入参的归一化
 *
 * 五个渲染器的命令式入口一律收 `{ wsPointData }` —— 那是原项目的字段名，
 * 记在 `contract.js` 的 `RENDERER_METHODS` 里。要求使用方也知道这个名字是
 * 没有道理的：采集侧、回放侧手里拿到的就是一个数组，或者协议层直接吐出来的
 * TypedArray。
 *
 * 所以这一层只做一件事：把使用方可能持有的几种形态，收敛成渲染器内部认识的
 * 那一种。放在 `core/` 而不是 react 层，因为它不碰 React，而回放与导出这些
 * 非渲染通路需要同一套判定。
 *
 * ## 为什么数组不复制
 *
 * 这是 30-100Hz 的热路径。普通数组原样透传（渲染器只读不写，各自 `map` 出
 * 新数组）；只有 TypedArray 才复制一次 —— 它的 `map` 返回同类型 TypedArray，
 * 而渲染器里有 `new Array(n).fill(0)` 这类回落分支要求普通数组，混着用会在
 * 极端帧上出现类型不一致。
 */

/**
 * 判断是否是可当作一帧读数的类数组。
 *
 * `ArrayBuffer.isView` 对 `DataView` 也返回真，但 `DataView` 没有 `length`，
 * 所以额外查一次 —— 否则会把它当成长度 undefined 的空帧推下去。
 *
 * @param {unknown} value 待判定值。
 * @returns {boolean} 是否是类数组帧。
 */
function isFrameArray(value) {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && typeof value.length === 'number';
}

/**
 * 把声明式 `frame` prop 归一化成渲染器命令式入口收的载荷。
 *
 * 支持四种入参：
 *
 * | 传入 | 结果 |
 * | :--- | :--- |
 * | `number[]` | `{ wsPointData: 原数组 }`（不复制） |
 * | `Uint8Array` / `Float32Array` 等 | `{ wsPointData: Array.from(...) }` |
 * | `{ wsPointData, ... }` | 原样透传，额外字段（`local` / `valuelInit`）保留 |
 * | `null` / `undefined` / 其他 | `null`，调用方据此跳过本次推送 |
 *
 * 空数组会得到 `{ wsPointData: [] }` 而不是 `null` —— "这一帧是空的"和
 * "没有这一帧"是两件事，前者该不该画由各渲染器自己决定（`blobHeatmap` 丢弃，
 * `numMatrix` 会清屏），这一层不替它们做主。
 *
 * @param {number[] | ArrayBufferView | {wsPointData?: number[]} | null | undefined} frame 声明式帧。
 * @returns {{wsPointData: number[]} | null} 命令式载荷，无法识别时为 null。
 */
export function toFramePayload(frame) {
  if (frame === null || frame === undefined) return null;

  if (Array.isArray(frame)) return { wsPointData: frame };
  if (isFrameArray(frame)) return { wsPointData: Array.from(frame) };

  if (typeof frame === 'object' && isFrameArray(frame.wsPointData)) {
    return Array.isArray(frame.wsPointData)
      ? frame
      : { ...frame, wsPointData: Array.from(frame.wsPointData) };
  }

  return null;
}
