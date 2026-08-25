/**
 * builtinLineOrders.js - 内置线序实现
 *
 * ## 这个文件为什么存在
 *
 * 线序（line order）是「设备物理走线顺序 → 显示顺序」的重排。`profiles.js` 里
 * 三个 profile 声明了线序名：`hand` 与 `smallBed12B` 用 `jqbed`，
 * `handSinglePoint` 用同名线序。
 *
 * 但在 2026-08-24 之前，`createProjectLineOrderRegistry()` **不注册任何实现** ——
 * 上游版本（`shroom1/sdk/src/line/projectLineOrders.js`）是从主项目根目录的
 * `openWeb.js` / `utilMatrix.js` 动态 require 进来的：
 *
 * ```js
 * sources.push(require('../../../openWeb'));   // shroom1/openWeb.js
 * sources.push(require('../../../utilMatrix'));
 * ```
 *
 * 抽成独立包时这两条 require 指向包外，被去掉了，但 profile 里的线序声明留着 ——
 * 于是这三个 profile 在**第一帧到达时**抛 `line order "jqbed" is not registered`，
 * 而抛点在串口 `data` 回调里，直接终止进程。
 *
 * 本文件把这两个实现逐字搬进包内，SDK 从此自带它们，不再依赖主项目。
 *
 * ## 搬运原则
 *
 * **逐字保留，包括看起来可疑的地方。** 这些函数的输出会进采集库和 CSV，
 * 改一行就是改历史数据的含义。已知的可疑点在各函数注释里标出，但都没有改。
 */

/**
 * JQ 床垫线序。逐字搬自 `shroom1/openWeb.js:851-868`。
 *
 * 两步：
 *
 * 1. **前 15 行上下翻转**（0↔14、1↔13 …… 7 居中不动）。原注释写的是
 *    「1-15行调换」。
 * 2. **把翻转后的前 15 行整体挪到末尾**，即后 17 行前移。
 *
 * 写死 32 列。`hand`（32×32）与 `smallBed12B`（32×32，uint16le）都满足。
 * 喂非 32 列的数据进来不会抛错，但结果无意义 —— 这与原实现一致，没有加校验，
 * 因为加了之后行为就和历史数据不一致了。
 *
 * 原件末尾有一行注释掉的 `press6(wsPointData, 32, 32, 'col')`，一并保留为注释。
 *
 * @param {number[]} arr 原始压力数组，长度应为 1024。
 * @returns {number[]} 重排后的数组，长度不变。
 */
function jqbed(arr) {
  let wsPointData = [...arr];

  // 1-15 行调换
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 32; j += 1) {
      const a = i * 32 + j;
      const b = (14 - i) * 32 + j;
      [wsPointData[a], wsPointData[b]] = [wsPointData[b], wsPointData[a]];
    }
  }

  const head = wsPointData.splice(0, 15 * 32);
  wsPointData = wsPointData.concat(head);

  // 原件此处有一行 `press6(wsPointData, 32, 32, 'col')`，是注释掉的，照留。
  return wsPointData;
}

/**
 * 手部单点线序。逐字搬自 `shroom1/openWeb.js:1328-1343`。
 *
 * 按三段重新拼接（下标从 1 开始计，取值时减 1）：
 *
 * | 段 | 源区间（1-based） | 方向 |
 * | :--- | :--- | :--- |
 * | 1 | 481 → 992，每 32 一行 | 正序 |
 * | 2 | 449 → 1，每 32 一行 | **逆序**（行倒着走，行内正序） |
 * | 3 | 993 → 1024 | 正序 |
 *
 * 也就是把 1024 点重排成「中段正序 + 前段倒序 + 尾段」。
 *
 * ⚠️ **原实现用 `arr[point - 1] || 0`**，也就是 `0`、`NaN`、`undefined` 都会
 * 落成 `0`。这与「压力 0」不可区分，但照抄 —— 改成 `?? 0` 会让历史数据里
 * 那些本来是 0 的点变成 NaN 透传，不是等价变换。
 *
 * @param {number[]} arr 原始压力数组，长度应为 1024。
 * @returns {number[]} 重排后的数组，长度 1024。
 */
function handSinglePoint(arr) {
  const wsPointData = [];

  for (let start = 481; start <= 992; start += 32) {
    for (let point = start; point < start + 32; point += 1) {
      wsPointData.push(arr[point - 1] || 0);
    }
  }

  for (let start = 449; start >= 1; start -= 32) {
    for (let point = start; point < start + 32; point += 1) {
      wsPointData.push(arr[point - 1] || 0);
    }
  }

  for (let point = 993; point <= 1024; point += 1) {
    wsPointData.push(arr[point - 1] || 0);
  }

  return wsPointData;
}

/**
 * 包内自带的线序实现。
 *
 * 只放 `DEFAULT_SENSOR_PROFILES` 真正引用到的那些 —— 主项目的 `openWeb.js` 里
 * 有几十个线序，绝大多数对应的 profile 没进这个 SDK。缺的那些由使用方通过
 * `extraLineOrders` 注入，或在 profile 里直接给函数。
 */
const BUILTIN_LINE_ORDERS = {
  jqbed,
  handSinglePoint,
};

module.exports = {
  BUILTIN_LINE_ORDERS,
  jqbed,
  handSinglePoint,
};
