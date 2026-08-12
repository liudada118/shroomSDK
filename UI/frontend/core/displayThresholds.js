/**
 * displayThresholds.js - 六个调参阈值的唯一读取处
 *
 * 抽这一层之前，全仓 54 个文件顶部都有同一段模块级声明，逐字如下（`three/hand.jsx`）：
 *
 * ```js
 * var valuej1 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 200,
 *   valueg1 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
 *   … 一共 12 行 …
 * ```
 *
 * 共 47 个声明块 / 2206 个读写点。`PointGridRenderer.jsx` 的文件头把它点名为
 * 「55 份复制粘贴的根因」，这个模块就是那个根因的收口。
 *
 * **这 47 个块的作用域并不统一**（计划里当成「51 个文件的模块级 var」是不准确的）：
 * 23 个在模块顶层（所有实例共享、冻结在模块加载时刻），24 个在
 * `React.forwardRef((props, refs) => {` 的**函数体内**（本来就是每实例、每次挂载重读）。
 * 这个差别直接决定了下面第 1 条的设计。
 *
 * ## 消费方式：解构，不是取对象
 *
 * ```js
 * var { valuej1, valueg1, value1, valuel1, valuef1, valuelInit1,
 *       valuej2, valueg2, value2, valuel2, valuef2, valuelInit2 }
 *   = createThresholdState(DUAL_CHANNEL_DEFAULTS);
 * ```
 *
 * 解构出来的是**普通局部绑定**，所以每个文件里那个 `sitValue(prop)` 照样能
 * `valuej1 = prop.valuej` 重新赋值，2206 个读写点一个字都不用动。这是刻意选的：
 * 真要改成 `t.valuej1` 就得动那 2206 处无测试覆盖的 legacy 代码，风险与这一步的
 * 收益不成比例。**每个块的作用域因此保持原样** —— 原来在模块顶层的仍是模块级共享，
 * 原来在组件函数里的仍是每实例。把模块级那 23 个也改成每实例需要 `stateRef`
 * （见 `PointGridRenderer` 的 `createTuningState`），那是各文件被改写成渲染器时
 * 顺带做的事，不在本层。
 *
 * ## 三个刻意的决定
 *
 * 1. **每次调用时读 localStorage，不做模块级共享快照。** 计划里原本写的是「store
 *    在自己的模块加载时读一次存成快照」，那样对**两种**作用域都不等价：函数内那 24
 *    个块今天是**每次挂载**重读（切走再切回会拿到新阈值），模块顶层那 23 个是各自
 *    被加载时读、而场景是懒加载的（改了阈值再切到一个还没加载过的展示形式会读到新值）。
 *    共享快照会把两者一起冻结在第一个消费者加载的时刻。所以这里在
 *    `createThresholdState()` 里现读 —— 调用点就是原来的声明处，时机逐字相同。
 *
 * 2. **默认值按变量名给，不按 localStorage 键给。** 因为默认值不统一，而且
 *    `wholeChair.jsx` 的两个通道**默认值还不一样**（`valueg1` 是 4 而 `valueg2` 是 2、
 *    `value1` 是 2.1 而 `value2` 是 2、`valuel1` 是 1 而 `valuel2` 是 2），
 *    按键给的话这三处会被静默改掉首屏表现。离群的三个文件见下面 `*_DEFAULTS` 注释。
 *
 * 3. **坏数据回落默认值而不抛。** 老写法 `getItem(k) ? JSON.parse(getItem(k)) : d`
 *    在 `getItem` 返回 `"abc"` 时会**在模块加载期抛异常**（整个页面打不开），返回
 *    `"null"` 时会把 `null` 当阈值用。这里照 `PointGridRenderer.readStoredNumber`
 *    已经立好的先例：try/catch + `Number.isFinite` 判定。与老写法的差异只在这两种
 *    坏数据上 —— 正常值（含 `0`）逐字相同。
 *
 * 写入侧不在这里：`Title.jsx` 的滑块 `localStorage.setItem` 之后走
 * `pushSitBack(...)` → 各文件的 `sitValue(prop)` 直接改内存里的绑定，
 * 不重读 localStorage。本模块只管「启动时的初值从哪来」。
 */

/** 六个阈值的变量名前缀 → localStorage 键。通道后缀 1/2 共用同一个键。 */
export const STORAGE_KEYS = Object.freeze({
  valuej: 'carValuej',
  valueg: 'carValueg',
  value: 'carValue',
  valuel: 'carValuel',
  valuef: 'carValuef',
  valuelInit: 'carValueInit',
});

/**
 * 从变量名推出 localStorage 键。`valuej1` / `valuej2` 都读 `carValuej`。
 *
 * @param {string} name 变量名，如 `valuej1`。
 * @returns {string} localStorage 键。
 * @throws {Error} 变量名不在六个阈值里时抛 —— 拼错了要当场知道，别静默读到 undefined。
 */
function storageKeyOf(name) {
  const prefix = String(name).replace(/[12]$/, '');
  const key = STORAGE_KEYS[prefix];
  if (!key) {
    throw new Error(`displayThresholds: 未知的阈值变量名 ${name}`);
  }
  return key;
}

/**
 * 读一个数值阈值。语义见文件头第 3 条。
 *
 * @param {string} storageKey localStorage 键。
 * @param {number} fallback 该变量自己的默认值。
 * @returns {number} 阈值。
 */
function readStoredNumber(storageKey, fallback) {
  try {
    // `globalThis.localStorage?.` 而不是裸 `localStorage`：照 `PointGridRenderer`
    // 立的先例，让这个模块能在非浏览器环境（后端测试的裸 Node ESM）被导入。
    // try/catch 兜的是隐私模式 / 配额那类**抛异常**的 localStorage，不是「没有」。
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 双通道默认值（后缀 1 为坐垫 / 主通道，2 为靠背 / 次通道）。
 *
 * 47 个声明块里 **37 个**逐字是这一份，另有 7 个是它的单通道版
 * （`SINGLE_CHANNEL_DEFAULTS`）。剩下 3 个是离群，各自覆盖：
 *
 * - `three/car10.jsx` —— `valuej* : 335`、`valueg* : 3.6`、`valuelInit* : 2000`
 * - `three/wholeChair.jsx` —— `valuej* : 255`，且**两通道不对称**：
 *   `valueg1 : 4` / `value1 : 2.1` / `valuel1 : 1`，通道 2 仍是这份默认值
 * - `three/Short.jsx` —— 通道 1 是 `2655 / 3.3 / 2.08 / 4 / 0`（与 `util.js`
 *   的 `initValue` 同源），通道 2 是这份默认值，`valuelInit1 : 2001`
 */
export const DUAL_CHANNEL_DEFAULTS = Object.freeze({
  valuej1: 200,
  valueg1: 2,
  value1: 2,
  valuel1: 2,
  valuef1: 2,
  valuelInit1: 2,
  valuej2: 200,
  valueg2: 2,
  value2: 2,
  valuel2: 2,
  valuef2: 2,
  valuelInit2: 2,
});

/** 单通道默认值。只有后缀 1 的那 7 个文件用（`num/NumWs.jsx`、`num/Num.jsx` 等）。 */
export const SINGLE_CHANNEL_DEFAULTS = Object.freeze({
  valuej1: 200,
  valueg1: 2,
  value1: 2,
  valuel1: 2,
  valuef1: 2,
  valuelInit1: 2,
});

/**
 * 只有后缀 2 的默认值。`three/4096.jsx` 与 `three/NumThreeColor copy.jsx` 这两个
 * 文件用 —— 它们的后缀 1 侧不是本地变量，而是 `assets/util/bed4096numParams.js`
 * 那个**共享调参对象**（文件里以 `const p = bed4096numParams` 别名出现，
 * 为的是「Bed4096 与 Fast256 切换模式时调参不重置」），只有后缀 2 是本地声明。
 */
export const SECOND_CHANNEL_DEFAULTS = Object.freeze({
  valuej2: 200,
  valueg2: 2,
  value2: 2,
  valuel2: 2,
  valuef2: 2,
  valuelInit2: 2,
});

/**
 * 按一份默认值读出对应的阈值。返回的键与传进来的默认值键**完全一致**，
 * 所以调用处解构时列什么名字，就必须在默认值里出现什么名字 —— 漏写一个
 * 会得到 `undefined` 而不是静默的 200，这是有意的。
 *
 * @param {Record<string, number>} defaults 变量名 → 默认值。
 * @returns {Record<string, number>} 变量名 → 当前阈值。
 */
export function createThresholdState(defaults) {
  const state = {};
  Object.keys(defaults).forEach((name) => {
    state[name] = readStoredNumber(storageKeyOf(name), defaults[name]);
  });
  return state;
}
