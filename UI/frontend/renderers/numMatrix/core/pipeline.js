/**
 * pipeline.js - 数字矩阵渲染器的纯数据管线
 *
 * 把原先内嵌在三份 NumThreeColor 的 `sitData()` / `animate()` 里的数据变换
 * 提取为纯函数。提取的意义有两层：
 *
 * 1. 可测：管线是纯的，参数化前后可以逐点比对，不需要启动 Electron
 *    或创建 WebGL 上下文。三份原实现被逐字抄进 `pipeline.test.js` 当基准。
 * 2. 可复用：三份文件用的是同一套变换，差别只在参数，提取之后
 *    它们才可能收敛成一个渲染器。
 *
 * 变换顺序与原实现逐字对应，不做任何「顺手优化」——
 * 一致性验证通过之前，任何改动都会污染基准。
 */

import { findMax } from '../../../core/frameMath.js';
import { TEXTURE_CELL_SIZE } from './params.js';

/**
 * 算精灵图的格数布局。
 *
 * 取自 `NumThreeColor1024.jsx:14-19` 的 `getTextureRange`，逐字保留。
 * 8 位数据走 16×16 的 256 格；12 位数据（最大 2550）超过 255 就改成 32 列，
 * 行数按需要算，因为 16×16 装不下 2551 个格子。
 *
 * @param {number} textureValueMax 精灵图要覆盖的最大数值；<=255 视为 8 位。
 * @returns {{max: number, cols: number, rows: number}} 最大值与格数布局。
 */
export function getTextureRange(textureValueMax) {
  const max = textureValueMax && textureValueMax > 255 ? Math.round(textureValueMax) : 255;
  return max > 255
    ? { max, cols: 32, rows: Math.ceil((max + 1) / 32) }
    : { max: 255, cols: 16, rows: 16 };
}

/**
 * 算精灵图画布的像素尺寸。
 *
 * @param {{cols: number, rows: number}} range `getTextureRange` 的结果。
 * @returns {{width: number, height: number}} 画布尺寸。
 */
export function getTextureCanvasSize(range) {
  return { width: range.cols * TEXTURE_CELL_SIZE, height: range.rows * TEXTURE_CELL_SIZE };
}

/**
 * 把一个数值夹到精灵图能表示的整数格。
 *
 * 取自 `NumThreeColor1024.jsx:20-23`。夹不住的话 uvOffset 会算出纹理外的坐标，
 * 表现为整格显示成别的数字。
 *
 * @param {number} value 原始数值。
 * @param {number} textureValueMax 精灵图最大值。
 * @returns {number} 0..max 之间的整数。
 */
export function clampTextureValue(value, textureValueMax) {
  const { max } = getTextureRange(textureValueMax);
  return Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
}

/**
 * 格式化精灵图上印的数字。
 *
 * 取自 `NumThreeColor1024.jsx:25-27`。decimalScale 为 10 时数据是放大十倍的
 * 定点数，印的时候除回去留一位小数。
 *
 * @param {number} value 纹理格索引（即放大后的整数）。
 * @param {number} decimalScale 定点倍率。
 * @returns {string} 印在格子上的文本。
 */
export function formatDisplayValue(value, decimalScale) {
  return decimalScale > 1 ? (Number(value) / decimalScale).toFixed(1) : String(value);
}

/**
 * 算精灵图字号。
 *
 * 取自 `NumThreeColor1024.jsx:249`。带小数的文本更长所以更小，32 列的
 * 纹理格子里数字位数更多所以也要缩一号。
 *
 * @param {number} textureMax 精灵图最大值。
 * @param {number} decimalScale 定点倍率。
 * @returns {number} 字号（px）。
 */
export function getTextureFontSize(textureMax, decimalScale) {
  if (decimalScale > 1) return 11;
  return textureMax > 255 ? 16 : 18;
}

/**
 * 算一格在世界坐标里的边长。
 *
 * 三份原实现写的是三个不同的表达式，但它们代数等价（验算见 `pipeline.test.js`）：
 *   `NumThreeColor copy`   size=4  → `0.032 * 4 = 0.128`
 *   `NumThreeColor1024sit` grid=23 → `2.048 / 23`
 *   `NumThreeColor1024`    通用     → `worldCellSize * 1.024`，其中
 *                                     `worldCellSize = 2 / max(gw, gh)`
 * 正交相机的可视范围是 [-1, 1]，所以「2 除以格数」就是一格占的世界宽度，
 * 再乘 1.024 让相邻格子略微交叠盖住缝。
 *
 * @param {number} gridWidth 网格列数。
 * @param {number} gridHeight 网格行数。
 * @returns {number} 一格的世界边长（格心间距）。
 */
export function deriveWorldCellSize(gridWidth, gridHeight) {
  return 2 / Math.max(gridWidth, gridHeight);
}

/**
 * 算实例平面的几何边长。
 *
 * @param {number} worldCellSize 格心间距。
 * @returns {number} PlaneGeometry 的边长。
 */
export function deriveCellPlaneSize(worldCellSize) {
  return worldCellSize * 1.024;
}

/**
 * 算第 index 个实例的世界坐标。
 *
 * 取自 `NumThreeColor1024.jsx:449-455`。三份原实现的写法各不相同但等价，
 * 化简过程见 `params.js` 顶部的表格。
 *
 * @param {number} index 实例序号。
 * @param {number} gridWidth 网格列数。
 * @param {number} gridHeight 网格行数。
 * @param {number} worldCellSize 格心间距。
 * @returns {{x: number, y: number}} 世界坐标。
 */
export function instanceWorldPosition(index, gridWidth, gridHeight, worldCellSize) {
  const x = index % gridWidth;
  const y = Math.floor(index / gridWidth);
  return {
    x: (x - (gridWidth - 1) / 2) * worldCellSize,
    y: (y - (gridHeight - 1) / 2) * worldCellSize,
  };
}

/**
 * 算某个数值在精灵图里的 uv 偏移。
 *
 * 取自 `NumThreeColor1024.jsx:544-545`。顶点着色器里 `vUv = uv * tileSize + uvOffset`，
 * 所以这里给的是格子左下角在 0..1 纹理空间的位置。
 *
 * @param {number} value 已夹好的纹理格索引。
 * @param {{cols: number, rows: number}} range 格数布局。
 * @returns {[number, number]} uv 偏移。
 */
export function cellUvOffset(value, range) {
  return [(value % range.cols) / range.cols, Math.floor(value / range.cols) / range.rows];
}

/**
 * 算 classic 配色的逐实例染色。
 *
 * 取自三份原实现共有的 `(r, 0.2, 1-r)`。片元着色器把它乘到精灵图上，
 * 所以它是叠在 jet 背景之上的第二层渐变，不是配色本身。
 *
 * `NumThreeColor copy` 与 `1024sit` 写死 `d / 255`，`1024` 写 `d / textureValueMax`
 * —— 8 位数据下 textureValueMax 恒为 255，两者相同。
 *
 * @param {number} value 已夹好的纹理格索引。
 * @param {number} textureValueMax 精灵图最大值。
 * @returns {[number, number, number]} 0..1 的 rgb 染色。
 */
export function classicTint(value, textureValueMax) {
  const r = value / textureValueMax;
  return [r, 0.2, 1.0 - r];
}

/**
 * 按下限过滤原始帧（进统计之前的那一遍）。
 *
 * 取自三份共有的 `ndata1.map((a) => (a - valuef1 < 0 ? 0 : a))`。
 * **注意这一遍不取整**，取整发生在下面 `quantizeFrame` 里 —— 所以侧栏统计
 * 用的是浮点值，画面上印的是整数。这个不对称是原实现的行为，照抄。
 *
 * @param {number[]} source 原始帧。
 * @param {number} floor 下限，对应 valuef1。
 * @returns {number[]} 过滤后的帧。
 */
export function applyFloorFilter(source, floor) {
  if (!Array.isArray(source)) return [];
  return source.map((value) => (value - floor < 0 ? 0 : value));
}

/**
 * 按下限过滤并量化成画面要用的整数帧。
 *
 * 取自 `NumThreeColor1024.jsx:520-524`。另外两份写的是更短的
 * `(a - valuef1 < 0 ? 0 : parseInt(a))`，对有限数值逐点相同；
 * **唯一差异是 NaN**：短写法给出 `parseInt(NaN) === NaN`，进而算出 NaN 的
 * uvOffset 把那一格渲染成随机数字，这里的写法给 0。对合法数据没有区别，
 * 所以取更稳的这一份。
 *
 * @param {number[]} source 原始帧。
 * @param {number} floor 下限，对应 valuef1。
 * @param {number} decimalScale 定点倍率。
 * @returns {number[]} 量化后的帧。
 */
export function quantizeFrame(source, floor, decimalScale) {
  if (!Array.isArray(source)) return [];
  return source.map((value) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue - floor < 0) return 0;
    return decimalScale > 1 ? Number(numberValue.toFixed(1)) : parseInt(numberValue, 10);
  });
}

/**
 * 算一帧的侧栏统计。
 *
 * 取自三份共有的 `sitData()` 中段，逐字保留 —— 包括 `point == 0 ? 1 : point`
 * 这个避免除零的写法。
 *
 * @param {number[]} frame 已过滤的帧。
 * @returns {{max: number, point: number, total: number, mean: number}} 统计值。
 */
export function computeFrameStats(frame) {
  const max = findMax(frame);
  const point = frame.filter((value) => value > 0).length;
  const total = frame.reduce((sum, value) => sum + value, 0);
  const mean = total / (point === 0 ? 1 : point);
  return { max, point, total, mean };
}

/**
 * 创建滚动窗口累积器。
 *
 * 对应三份原实现里的 `totalArr` / `totalPointArr` 那两段
 * `if (arr.length < 20) push else { shift; push }`。
 *
 * **行为变化（有意）**：原实现把这两个数组放在组件函数作用域，重新挂载会重置；
 * 但把它们放模块作用域的其他场景组件（那 8 份 layoutData）会跨挂载续画。
 * 这里是每实例，与三份 NumThreeColor 的原行为一致。
 *
 * @param {number} windowSize 窗口长度，三份原实现都是 20。
 * @returns {{push: (value: number) => number[], values: () => number[]}} 累积器。
 */
export function createRollingWindow(windowSize) {
  const values = [];
  return {
    push(value) {
      if (values.length < windowSize) {
        values.push(value);
      } else {
        values.shift();
        values.push(value);
      }
      return values;
    },
    values: () => values,
  };
}

/**
 * 算画布边长。
 *
 * 取自三份共有的 `window.innerHeight < 750 ? h * compact : h * normal`。
 * 三份的比例不同（0.6/0.8 两份，0.5/0.65 一份），所以比例是参数。
 *
 * @param {number} viewportHeight 视口高度。
 * @param {{compact: number, normal: number}} ratio 高度比例。
 * @returns {number} 画布边长（px）。
 */
export function resolveCanvasSize(viewportHeight, ratio) {
  return viewportHeight < 750 ? viewportHeight * ratio.compact : viewportHeight * ratio.normal;
}
