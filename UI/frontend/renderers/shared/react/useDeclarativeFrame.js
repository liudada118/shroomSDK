/**
 * useDeclarativeFrame.js - 声明式帧 prop 的推送钩子
 *
 * 五个渲染器原本只有命令式入口，宿主要画一帧必须写四步：建 ref、挂到组件、
 * `useEffect` 盯数据、`ref.current.sitData({ wsPointData: matrix })`。第四步
 * 里的 `wsPointData` 还是原项目的字段名，新使用方无从得知。
 *
 * 这个钩子把那四步收成一个 prop。命令式通路完全不动 —— 两条可以共存，宿主
 * 需要 `sitValue` / `reset` / `bthClickHandle` 时照旧拿 ref。
 *
 * ## resetKey 是必须的，不是可选的优化
 *
 * `numMatrix` / `pointGrid` / `handPoints` 在参数变化时会**整场重建**（顶点
 * 缓冲区大小由网格尺寸决定），重建过程中 `state.api` 被置空。如果只依赖
 * `frame`，那么"参数变了但帧没变"之后画面会是空的 —— 声明式通路必须在重建后
 * 把最后一帧重推一次。传各组件已有的 `paramsKey`（按内容记忆化的字符串）即可。
 */

import { useEffect, useRef } from 'react';

import { toFramePayload } from '../../../core/framePayload.js';

/**
 * 把声明式 `frame` prop 推给渲染器的命令式入口。
 *
 * `push` 存在 ref 里而不进依赖数组：它几乎每次渲染都是新的闭包（内部读
 * `stateRef.current.api`），进依赖会让每次父组件渲染都重推一帧。
 *
 * 帧的比较用引用相等，也就是 React 的默认语义：**原地改同一个数组不会触发
 * 重推**。高频通路本来就该每帧给一个新数组（协议层 `map` 出来的天然是新的），
 * 复用同一个 buffer 的宿主请继续走 ref 上的 `sitData`。
 *
 * @param {number[] | ArrayBufferView | {wsPointData?: number[]} | null | undefined} frame 声明式帧。
 * @param {(payload: {wsPointData: number[]}) => void} push 推送实现，通常转调 `sitData`。
 * @param {string} [resetKey] 场景重建标记；变化时把当前帧重推一次。
 * @returns {void}
 */
export function useDeclarativeFrame(frame, push, resetKey) {
  const pushRef = useRef(push);
  pushRef.current = push;

  useEffect(() => {
    const payload = toFramePayload(frame);
    if (!payload) return;
    pushRef.current(payload);
  }, [frame, resetKey]);
}

export default useDeclarativeFrame;
