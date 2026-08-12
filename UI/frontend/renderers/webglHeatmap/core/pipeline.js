/**
 * renderers/webglHeatmap/core/pipeline.js - 斑点热力的帧运算
 *
 * 逐字来自 `client/src/components/webgl/Canvas4096WebGL.jsx` 的 `renderFrame`
 * （边缘清零 / 左右镜像 / 下限过滤）与 `WebGL.HeatMap copy 2.js` 的
 * `genWebglHeatmap`（铺点）。这四步原来都写死成 64×64 + 1024×1024 + ×1.8，
 * 二开换一个矩阵尺寸就得改源码；提出来之后是参数。
 *
 * 纯函数、零依赖，`smoke-core.mjs` 与 `pipeline.test.js` 都能直接跑。
 */

/**
 * 边缘清零：把 `[keepFrom, keepTo]` 之外的行列全部置 0。
 *
 * ⚠️ **窗口不对称，照抄。** 原件写的是 `(i < 6 || i > 58) || (j < 6 || j > 58)`
 * —— 64 行里上边切 6 行（0..5）、下边只切 5 行（59..63）。看起来像手误，但那是
 * 现在屏幕上的样子，搬家不改观感。要对称就传 `keepTo: 57`。
 *
 * @param {number[]} values 输入帧，长度应为 `width * height`。
 * @param {number} width 每行几个数。
 * @param {number} height 几行。
 * @param {number} keepFrom 保留的起始下标（含）。
 * @param {number} keepTo 保留的结束下标（含）。
 * @returns {number[]} 新数组，不改原数组。
 */
export function clearEdges(values, width, height, keepFrom, keepTo) {
  const result = [...values];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (row < keepFrom || row > keepTo || col < keepFrom || col > keepTo) {
        result[row * width + col] = 0;
      }
    }
  }
  return result;
}

/**
 * 左右镜像：每一行首尾对调。
 *
 * 传感器铺设方向与屏幕方向相反，原件靠这一步把画面翻过来。
 *
 * @param {number[]} values 输入帧。
 * @param {number} width 每行几个数。
 * @param {number} height 几行。
 * @returns {number[]} 新数组，不改原数组。
 */
export function mirrorRows(values, width, height) {
  const result = [...values];
  const half = Math.floor(width / 2);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < half; col += 1) {
      const left = row * width + col;
      const right = row * width + (width - 1 - col);
      const swap = result[left];
      result[left] = result[right];
      result[right] = swap;
    }
  }
  return result;
}

/**
 * 下限过滤：小于 `floor` 的值归零。
 *
 * @param {number[]} values 输入帧。
 * @param {number} floor 下限（对应侧栏那个 `valuef` 滑块）。
 * @returns {number[]} 新数组。
 */
export function applyFloor(values, floor) {
  if (!floor) return [...values];
  return values.map((value) => (value < floor ? 0 : value));
}

/**
 * 一帧的完整预处理：边缘清零 → 左右镜像 → 下限过滤。
 *
 * 三步的**顺序是有意义的**：镜像在清零之后，所以不对称的那个窗口也跟着翻了
 * 过来（上切 6 下切 5 变成左切 5 右切 6 …实际上窗口对 i / j 用的是同一对边界，
 * 镜像只影响列）。照原件的顺序。
 *
 * @param {number[]} raw 原始帧。
 * @param {object} params 归一化后的参数（见 `./params.js`）。
 * @returns {number[]} 可以直接喂给 `buildHeatPoints` 的数组。
 */
export function prepareFrame(raw, params) {
  const { dataWidth, dataHeight, edgeClear, mirrorX, filter } = params;
  let values = Array.isArray(raw) ? [...raw] : [];
  if (edgeClear) {
    values = clearEdges(values, dataWidth, dataHeight, edgeClear.keepFrom, edgeClear.keepTo);
  }
  if (mirrorX) {
    values = mirrorRows(values, dataWidth, dataHeight);
  }
  return applyFloor(values, filter);
}

/**
 * 把一帧铺成 WebGL 要的点表：`[[x像素, y像素, 值], …]`。
 *
 * ⚠️ **`values[idx] ? values[idx] * scale : 0` 是原件写法，照抄。** 它对 0 / NaN
 * / `undefined` 一律给 0 —— 和 `Number.isFinite` 判断在正常数据上同解，在缺数
 * 据（`values` 比 `dataWidth * dataHeight` 短）时也同解。改成算术判断没有收益，
 * 却要多论证一遍。
 *
 * @param {number[]} values 预处理过的帧。
 * @param {object} params 归一化后的参数。
 * @returns {Array<[number, number, number]>} 点表。
 */
export function buildHeatPoints(values, params) {
  const { dataWidth, dataHeight, canvasWidth, canvasHeight, valueScale } = params;
  const stepX = canvasWidth / dataWidth;
  const stepY = canvasHeight / dataHeight;
  const points = [];
  for (let row = 0; row < dataHeight; row += 1) {
    for (let col = 0; col < dataWidth; col += 1) {
      const value = values[row * dataWidth + col];
      points.push([col * stepX, row * stepY, value ? value * valueScale : 0]);
    }
  }
  return points;
}

/**
 * 侧栏那四个读数：均压 / 最大值 / 受压点数 / 总压。
 *
 * 与 `Canvas4096WebGL.updatePressureStats` 逐字一致，包括
 * `mean = press / (point === 0 ? 1 : point)` 这个"没有受压点时按 1 除"的约定
 * （不是按 0 除出 NaN）和 `toFixed(2)` 出字符串。
 *
 * @param {number[]} values 一帧原始数据（不是预处理后的）。
 * @returns {{meanPres: string, maxPres: number, point: number, totalPres: number}} 读数。
 */
export function frameStats(values) {
  const list = Array.isArray(values) ? values : [];
  const max = list.reduce((acc, item) => (acc > item ? acc : item), 0);
  const point = list.filter((item) => item > 0).length;
  const press = list.reduce((sum, item) => sum + item, 0);
  const mean = press / (point === 0 ? 1 : point);
  return {
    meanPres: mean.toFixed(2),
    maxPres: max,
    point,
    totalPres: press,
  };
}

/**
 * 定长滑窗追加，用于两条曲线。窗口满了就丢最早的一个。
 *
 * @param {number[]} window 现有窗口（原地修改，与原件一致）。
 * @param {number} value 新值。
 * @param {number} size 窗口长度。
 * @returns {number[]} 同一个数组。
 */
export function pushWindow(window, value, size) {
  if (window.length >= size) window.shift();
  window.push(value);
  return window;
}
