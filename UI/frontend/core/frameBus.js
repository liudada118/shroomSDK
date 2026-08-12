/**
 * frameBus.js - 场景帧总线
 *
 * ## 为什么需要它
 *
 * 今天 Home.jsx 把每一帧数据用 `this.com.current.changeWsData147(...)` 这种
 * 方式**推**给场景组件。这带来两个后果：
 *
 * 1. Home 必须知道每个场景组件的私有方法名和私有数据形状 ——
 *    `changeWsData147` / `changeWsData256` / `changeWsDatafinger` /
 *    `changeWsDatapalm` / `changeWsData147R({ left })` 各叫各的名字，
 *    于是 Home 里长出一条 `if (matrixName == ...)` 的阶梯替场景做整形。
 * 2. 换一个场景组件就要改 Home。依赖方向是反的。
 *
 * 总线把方向倒过来：**Home 只 publish 一帧规范化数据，渲染器自己订阅、
 * 自己取自己要的那部分。** Home 不再需要知道 `changeWsData147` 这个名字存在。
 *
 * ## 为什么不改成 props
 *
 * 因为帧率是 30–100Hz，而 `CanvasCom.shouldComponentUpdate` 是一堵**故意砌的墙**：
 * 它只放行 5 个稳定字符串键，其余 prop 一律挡住，为的就是不让高频数据
 * 触发 React 对 Home 那棵 5000 多行的 render 树做调和。把帧数据改成 prop
 * 会正面撞上这堵墙 —— 那不是解耦，是性能倒退。
 *
 * 所以总线**不进 React state**：publish 直接同步调用订阅者，一帧都不会
 * 触发重渲染。数据在物理上仍然绕开 React，只是依赖方向反了过来。
 *
 * ## 形状照抄 formulaChartStore.js
 *
 * 那个文件的纪律是「一个 localStorage 键只有一个主人，谁改了谁通知」，
 * 实现就是 `Set` + `notify`。这里是同一个形状，只是不落盘。
 * 仓库里已经有的惯用法，不另发明一套。
 */

/** 订阅者集合。用 Set 而不是数组：退订是 O(1)，且天然去重。 */
const listeners = new Set();

/** 最近一帧。新订阅者立刻补发，避免切换渲染器后白屏等下一帧。 */
let lastFrame = null;

/**
 * 订阅帧。
 *
 * 订阅时如果总线上已经有帧，会**立刻同步补发一次**。这一条是必需的：
 * 渲染器是懒加载的，挂载完成时数据流早就在跑了，不补发的话画面要空到
 * 下一帧才出来 —— 低帧率设备上肉眼可见。
 *
 * @param {(frame: object) => void} listener 帧回调。
 * @returns {() => void} 退订函数。
 */
export function subscribeFrames(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);

  if (lastFrame) {
    try {
      listener(lastFrame);
    } catch {
      // 补发出错不该让订阅本身失败 —— 订阅者已经在集合里了，
      // 下一帧还有机会。
    }
  }

  return () => {
    listeners.delete(listener);
  };
}

/**
 * 发布一帧。
 *
 * 单个订阅者抛异常不会带塌其余 —— 一个渲染器画崩了，侧栏统计还得照常走。
 * 这和 `formulaChartStore.notify` 的处置一致。
 *
 * @param {object} frame 规范帧。
 * @returns {number} 收到这一帧的订阅者数量。
 */
export function publishFrame(frame) {
  if (!frame || typeof frame !== 'object') return 0;
  lastFrame = frame;

  let delivered = 0;
  listeners.forEach((listener) => {
    try {
      listener(frame);
      delivered += 1;
    } catch (error) {
      console.error('[frameBus] 订阅者处理帧数据出错:', error);
    }
  });
  return delivered;
}

/**
 * 读取最近一帧。
 *
 * 给不方便订阅的调用方（例如点一次按钮才需要当前值的命令）用。
 *
 * @returns {object | null} 最近一帧，还没有帧时为 null。
 */
export function getLastFrame() {
  return lastFrame;
}

/**
 * 丢弃最近一帧。
 *
 * 切换展示形式时调用：上一个设备的最后一帧不应该被补发给下一个渲染器，
 * 那会画出一帧属于别的矩阵的数据。
 */
export function clearLastFrame() {
  lastFrame = null;
}

/**
 * 清空总线。仅供测试使用。
 */
export function resetFrameBus() {
  listeners.clear();
  lastFrame = null;
}
