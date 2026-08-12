/**
 * jetLadder.js - jet 配色的那条四段分支阶梯，全仓唯一一份
 *
 * **这个文件为什么单独存在，而不是留在 `util.js` 里。**
 *
 * `components/displaySystem/colormaps.js` 会被后端测试用**裸 Node ESM** 加载
 * （`backend/tests/sdk/displayProfileRuntime.test.js` 里的 `await import(pathToFileURL(...))`，
 * 没有 Vite 的解析器）。这带来两条硬约束，`util.js` 两条都不满足：
 *
 * 1. **导入必须写全 `.js` 扩展名。** Node ESM 不做扩展名补全，而 `util.js`
 *    内部写的是 `from "./color"` / `from "./value"`。这也是 `colormaps.js`
 *    `displayProfileRuntime.js` 这一圈文件的导入本来就都带 `.js` 的原因。
 * 2. **不能在模块顶层读 `localStorage`。** `util.js` 顶层就有（`initValue`），
 *    裸 Node 下会直接抛。
 *
 * 所以阶梯放在这个**零依赖、零副作用**的文件里，`util.js` 与 `colormaps.js`
 * 各自 import 它 —— 而不是让 `colormaps.js` 去 import 整个 `util.js`，
 * 也不是在 `colormaps.js` 里再抄一遍公式（那就是第 19 份拷贝了）。
 *
 * 对外仍然从 `util.js` 取（它原样 re-export），80 个消费文件的导入路径不用动。
 */

/**
 * jet 配色的唯一一条分支阶梯。返回 0..1 的浮点分量，取整策略交给出口函数。
 *
 * 出口有三个，都在 `util.js`：`jet`（`parseInt` 三元组）、`jetRgba`
 * （不取整 + 写死的第四位）、`jetRound`（`Math.round` + 零跨度返白）。
 * 抽这一层之前，这条阶梯在全仓有 18 份复制粘贴。
 *
 * **不要改动它的数值。** 全仓 18 处配色都从这里出去，改一个系数就是 18 处
 * 同时变色，而这些是客户已经看惯的压力图。四段的分界用的是 `<` 而非 `<=`，
 * `x` 恰好落在 `min + 0.25 * dv` 上时走的是下一段 —— 照抄原实现，别"顺手修正"。
 *
 * 对应测试见 `util.jet.test.js`，它把被替换掉的四份原实现逐字抄进测试当基准。
 *
 * @param {number} min 值域下界。
 * @param {number} max 值域上界。
 * @param {number} x 取样值，超出 [min, max] 会被夹取。
 * @returns {{r: number, g: number, b: number}} 各分量 0..1；`max === min` 时 g 为 NaN。
 */
/**
 * 上面那条阶梯的**声明式副本**，供代码生成用（见 `colormaps.js` 的
 * `glslJetLadder()`）。
 *
 * 为什么不是让 `jetRgb` 去读这张表：`jetRgb` 的注释写着「不要改动它的数值」，
 * 全仓 18 处配色从它出去。把它改写成表驱动就是在改那 18 处的实现，收益为零、
 * 风险全是。所以这里放一份**平行**的表，再用测试逐点钉死两者等价
 * （`core/jetLadder.test.js` 里对 0..1 采样逐点比对 `jetRgb`）——
 * 表漂了测试立刻红，不会出现「GLSL 那份和 JS 那份悄悄分家」。
 *
 * 每段的通道值有两种写法：
 * - 数字：常量分量；
 * - `{ slope, from }`：`base + slope * (t - from)`，`base` 由斜率符号决定
 *   （正斜率从 0 起、负斜率从 1 起）—— 四段全部符合这个规律。
 *
 * `t` 是归一化后的取样位置 `(x - min) / (max - min)`，`until` 是该段的开区间
 * 上界（用 `<`，与 `jetRgb` 一致：恰好落在断点上走下一段）。
 */
export const JET_LADDER_SEGMENTS = [
  { until: 0.25, r: 0, g: { slope: 4, from: 0 }, b: 1 },
  { until: 0.5, r: 0, g: 1, b: { slope: -4, from: 0.25 } },
  { until: 0.75, r: { slope: 4, from: 0.5 }, g: 1, b: 0 },
  { until: 1, r: 1, g: { slope: -4, from: 0.75 }, b: 0 },
];

/**
 * 按 `JET_LADDER_SEGMENTS` 求值，等价于 `jetRgb(0, 1, t)`。
 *
 * 只用于测试与代码生成的自证，运行期配色仍然走 `jetRgb`。
 *
 * @param {number} t 归一化取样位置。
 * @returns {{r: number, g: number, b: number}} 各分量 0..1。
 */
export function jetLadderSegmentRgb(t) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const segment = JET_LADDER_SEGMENTS.find((entry) => clamped < entry.until)
    || JET_LADDER_SEGMENTS[JET_LADDER_SEGMENTS.length - 1];
  const channel = (spec) => {
    if (typeof spec === 'number') return spec;
    const base = spec.slope > 0 ? 0 : 1;
    return base + spec.slope * (clamped - spec.from);
  };
  return { r: channel(segment.r), g: channel(segment.g), b: channel(segment.b) };
}

export function jetRgb(min, max, x) {
  let red, g, blue;
  let dv;
  red = 1.0;
  g = 1.0;
  blue = 1.0;
  if (x < min) {
    x = min;
  }
  if (x > max) {
    x = max;
  }
  dv = max - min;
  if (x < min + 0.25 * dv) {
    red = 0;
    g = (4 * (x - min)) / dv;
  } else if (x < min + 0.5 * dv) {
    red = 0;
    blue = 1 + (4 * (min + 0.25 * dv - x)) / dv;
  } else if (x < min + 0.75 * dv) {
    red = (4 * (x - min - 0.5 * dv)) / dv;
    blue = 0;
  } else {
    g = 1 + (4 * (min + 0.75 * dv - x)) / dv;
    blue = 0;
  }

  return { r: red, g: g, b: blue };
}
