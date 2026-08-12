/**
 * renderers/numMatrix/core/layouts.js - 数字矩阵的点位铺排层（纯函数 + 点表）
 *
 * 这一层回答的是同一个问题：**一帧长度不等于 `gridWidth * gridHeight` 的原始数据，
 * 怎么落到规则网格上**。三份老实现（`NumWs.jsx` / `Num2D.jsx` / `Num2Doriginal.jsx`）
 * 各自在组件函数体里写了一遍，点表还是每次调用重建的字面量。
 *
 * 搬到这里的判据只有一条：**没有 React / three / DOM**，所以
 * `scripts/smoke-core.mjs` 能在裸 Node 里直接 import 它们，也就能逐点比对。
 * 视口相关的两个函数（`matrixViewportBounds`）**不读 `window`**，宽高由调用方传进来
 * —— 这是它们能留在零依赖层的原因，也是渲染器「按容器画」那条积压的接口预留。
 *
 * ⚠️ **点表提到模块级之后不能就地改。** 老实现是 `let pointArr = [...]` 写在函数体内，
 * 每次调用重建，于是「就地 `+= 4`」的副作用每帧都被抹掉，看不出问题。提到模块级
 * 之后必须算到局部变量里，否则偏移会逐帧累加。
 */

/** 手套 147 的目标网格：32×32；补边 2 圈后是 36×36。 */
export const GLOVE_147_BASE = 32;
export const GLOVE_147_PADDED = 36;

/**
 * `changeWsData147` 用的 150 点位表：手套 147 个采样点在 32×32 网格里的落点。
 *
 * `NumWs.jsx:206` 与 `Num2D.jsx:647` 里各有一份**逐字相同**的字面量，合成这一份。
 */
export const GLOVE_147_POINTS = [
  [16, 30], [16, 29], [16, 28], [2, 18], [2, 17], [2, 16], [1, 13], [1, 12], [1, 11],
  [2, 8], [2, 7], [2, 6], [5, 4], [5, 3], [5, 2],
  [17, 30], [17, 29], [17, 28], [3, 18], [3, 17], [3, 16], [2, 13], [2, 12], [2, 11],
  [3, 8], [3, 7], [3, 6], [6, 4], [6, 3], [6, 2],
  [18, 29], [18, 28], [18, 27], [4, 18], [4, 17], [4, 16], [3, 13], [3, 12], [3, 11],
  [4, 8], [4, 7], [4, 6], [7, 4], [7, 3], [7, 2],
  [19, 29], [19, 28], [19, 27], [5, 18], [5, 17], [5, 16], [4, 13], [4, 12], [4, 11],
  [5, 8], [5, 7], [5, 6], [8, 4], [8, 3], [8, 2],
  [22, 28], [22, 27], [22, 26], [8, 17], [8, 16], [8, 15], [7, 13], [7, 12], [7, 11],
  [8, 9], [8, 8], [8, 7], [11, 5], [11, 4], [11, 3],
  [19, 15], [19, 14], [19, 13], [19, 12], [19, 11], [19, 10], [19, 9], [19, 8], [19, 7],
  [19, 6], [19, 5], [19, 4],
  [21, 18], [21, 17], [21, 16], [21, 15], [21, 14], [21, 13], [21, 12], [21, 11], [21, 10],
  [21, 9], [21, 8], [21, 7], [21, 6], [21, 5], [21, 4],
  [23, 18], [23, 17], [23, 16], [23, 15], [23, 14], [23, 13], [23, 12], [23, 11], [23, 10],
  [23, 9], [23, 8], [23, 7], [23, 6], [23, 5], [23, 4],
  [25, 18], [25, 17], [25, 16], [25, 15], [25, 14], [25, 13], [25, 12], [25, 11], [25, 10],
  [25, 9], [25, 8], [25, 7], [25, 6], [25, 5], [25, 4],
  [27, 18], [27, 17], [27, 16], [27, 15], [27, 14], [27, 13], [27, 12], [27, 11], [27, 10],
  [27, 9], [27, 8], [27, 7], [27, 6], [27, 5], [27, 4],
];

/**
 * 列偏移只作用在**前 75 个点**上。
 *
 * 两份原实现的循环都是 `for (j < 5) for (k < 15)`，`index = j * 15 + k` ——
 * 上界是 75，不是 `pointArr.length`。点 75–149 是那五条 12/15 长的手指列，
 * **不参与列偏移**。写成常量是因为这一点极易看漏：把 `k` 写成 `i % 15` 再遍历
 * 全部 150 个点，结果就是手指整体横移。
 */
const GLOVE_147_COLUMN_SHIFT_LIMIT = 75;

/**
 * 大拇指那 15 个点（`i ∈ [60, 75)`）往下盖的行偏移，**两份原实现在这里不一样**。
 *
 * | 出处 | 写到哪几行 | 为什么 |
 * | :--- | :--- | :--- |
 * | `NumWs.jsx`（canvas2d） | `row, row+5, row+6, row+7` | `index` 在 `+= 4` **之前**算好并写入，`j = 1..3` 读的是 `+= 4` **之后**的 `nowArr[0]` |
 * | `Num2D.jsx`（webgl） | `row+4, row+5, row+6, row+7` | 没有那次提前写入，`j = 0..3` 全部读 `+= 4` 之后的值 |
 *
 * 两者都是「先就地改再从同一个对象读」造成的，但结果确实不同：canvas2d 那份多亮
 * `row`、不亮 `row+4`。**这不是可以统一的事故，是两个展示形式各自已经在跑的画面**，
 * 所以做成参数而不是挑一个。
 */
export const GLOVE_147_THUMB_ROWS_CANVAS2D = [0, 5, 6, 7];
export const GLOVE_147_THUMB_ROWS_WEBGL = [4, 5, 6, 7];

/**
 * 把 147 点位铺进 32×32。
 *
 * @param {number[]} wsPointData 手套原始帧，取前 150 个。
 * @param {{thumbRowOffsets?: number[]}} [options] `thumbRowOffsets` 见
 *   `GLOVE_147_THUMB_ROWS_*`，缺省用 webgl 那份。
 * @returns {number[]} 长度 1024 的 32×32 帧。
 */
export function applyGlove147Layout(wsPointData, options = {}) {
  const thumbRowOffsets = options.thumbRowOffsets || GLOVE_147_THUMB_ROWS_WEBGL;
  const newArr = new Array(GLOVE_147_BASE * GLOVE_147_BASE).fill(0);

  for (let i = 0; i < GLOVE_147_POINTS.length; i++) {
    const [baseRow, baseCol] = GLOVE_147_POINTS[i];

    let col = baseCol;
    if (i < GLOVE_147_COLUMN_SHIFT_LIMIT) {
      const k = i % 15;
      if (k >= 3 && k < 6) col += 4;
      else if (k >= 6 && k < 9) col += 2;
      else if (k >= 9 && k < 12) col += 0;
      else if (k >= 12 && k < 15) col -= 2;
    }

    let row = baseRow;
    if (i >= 15 && i < 4 * 15) row += Math.floor(i / 15);

    const put = (r) => {
      newArr[r * GLOVE_147_BASE + col] = wsPointData[i];
    };

    if (i >= 4 * 15 && i < 5 * 15) {
      thumbRowOffsets.forEach((offset) => put(row + offset));
    } else {
      put(row);
      put(row + 1);
    }
  }

  return newArr;
}

/**
 * 把手套的一块子矩阵盖进 32×32 的指定位置。
 *
 * `changeWsDatafinger`（`NumWs.jsx:295-316`）与 `changeWsDatapalm`（`318-339`）
 * 除了取哪几列、盖到哪几行之外一字不差，合成一个。
 *
 * @param {number[]} wsPointData 手套原始帧，按 15 列排布。
 * @param {{rows: number[], cols: number[], atRow: number, atCol: number}} region 取哪块、盖到哪。
 * @returns {number[]} 长度 1024 的 32×32 帧。
 */
export function placeGloveRegion(wsPointData, region) {
  const values = [];
  for (let i = region.rows[0]; i < region.rows[1]; i++) {
    for (let j = region.cols[0]; j < region.cols[1]; j++) {
      values.push(wsPointData[i * 15 + j]);
    }
  }

  const newArr = new Array(GLOVE_147_BASE * GLOVE_147_BASE).fill(0);
  const width = region.cols[1] - region.cols[0];
  for (let k = 0; k < values.length; k++) {
    const row = region.atRow + Math.floor(k / width);
    const col = region.atCol + (k % width);
    newArr[row * GLOVE_147_BASE + col] = values[k];
  }
  return newArr;
}

/**
 * 手套 147 在 15 列布局下的补位（`Num2Doriginal.jsx:941-951`）。
 *
 * 两条分支：整包手套（`handGloveFullPacket` 且长度 ≥ 189）补 / 截到 195（15×13）；
 * 其余在第 75 位插三个 0 凑成 150（15×10）。
 *
 * @param {number[]} wsPointData 手套原始帧。
 * @param {{fullPacket?: boolean}} [options] 是否走整包分支。
 * @returns {{data: number[], gridWidth: number, gridHeight: number}} 补位后的帧与尺寸。
 */
export function padGlove147Rows(wsPointData, options = {}) {
  let data = [...wsPointData];
  const fullPacket = Boolean(options.fullPacket) && data.length >= 189;

  if (fullPacket) {
    while (data.length < 195) data.push(0);
    if (data.length > 195) data = data.slice(0, 195);
  } else {
    data.splice(5 * 15, 0, 0);
    data.splice(5 * 15, 0, 0);
    data.splice(5 * 15, 0, 0);
  }

  return { data, gridWidth: 15, gridHeight: fullPacket ? 13 : 10 };
}

/** 足底 60 个采样点在 16×32 网格里的落点（`Num2D.jsx:582`，两处字面量相同）。 */
export const FOOT_60_POINTS = [
  [2, 2], [2, 4], [2, 6], [2, 8], [2, 10], [2, 12],
  [5, 1], [5, 4], [5, 6], [5, 8], [5, 11], [5, 13],
  [8, 1], [8, 4], [8, 6], [8, 8], [8, 11], [8, 14],
  [11, 2], [11, 5], [11, 8], [11, 10], [11, 12], [11, 14],
  [14, 2], [14, 5], [14, 8], [14, 10], [14, 12], [14, 14],
  [17, 2], [17, 4], [17, 6], [17, 8], [17, 10], [17, 12],
  [20, 2], [20, 4], [20, 6], [20, 8], [20, 10], [20, 12],
  [23, 2], [23, 4], [23, 6], [23, 8], [23, 10], [23, 12],
  [26, 2], [26, 4], [26, 6], [26, 8], [26, 10], [26, 11],
  [29, 3], [29, 5], [29, 6], [29, 8], [29, 9], [29, 11],
];

/** 足底铺排的目标网格。 */
export const FOOT_GRID_WIDTH = 16;
export const FOOT_GRID_HEIGHT = 32;

/**
 * 足底双向线性插值（`Num2D.jsx:14-43`）。
 *
 * 两段：先按点表的六列在行内补齐，再按相邻行组做 1/3 与 2/3 插值。
 * `Math.floor(x * 10) / 10` 的一位小数截断是原行为，不要"顺手换成"四舍五入。
 *
 * @param {number[]} arr 已按点表落点的扁平帧。
 * @param {Array<[number, number]>} footPointArr 点表（每行 6 个点，共 10 行）。
 * @param {number} [rowWidth=16] 网格宽度。
 * @returns {number[]} 插值后的新数组（不改入参）。
 */
export function footInterp(arr, footPointArr, rowWidth = FOOT_GRID_WIDTH) {
  const newArr = [...arr];

  for (let i = 0; i < 10; i++) {
    for (let j = 1; j < 6; j++) {
      const col = footPointArr[i * 6 + j][0];
      const length = footPointArr[i * 6 + j][1] - footPointArr[i * 6 + j - 1][1];
      const firstIndex = footPointArr[i * 6 + j - 1][1];
      const lastIndex = footPointArr[i * 6 + j][1];
      const firstValue = newArr[col * rowWidth + firstIndex];
      const lastValue = newArr[col * rowWidth + lastIndex];
      const cha = lastValue - firstValue;
      for (let k = 1; k < length; k++) {
        newArr[col * rowWidth + firstIndex + k] = firstValue + Math.floor((cha * 10) / length) / 10;
      }
    }
  }

  for (let i = 0; i < 9; i++) {
    const col = footPointArr[i * 6 + 0][0];
    const nextCol = footPointArr[(i + 1) * 6 + 0][0];
    const firstIndex = footPointArr[i * 6 + 0][1];
    const lastIndex = footPointArr[i * 6 + 5][1];
    for (let j = firstIndex; j <= lastIndex; j++) {
      const base = newArr[col * rowWidth + j];
      const delta = newArr[nextCol * rowWidth + j] - base;
      newArr[(col + 1) * rowWidth + j] = base + Math.floor((delta * 10 * 1) / 3) / 10;
      newArr[(col + 2) * rowWidth + j] = base + Math.floor((delta * 10 * 2) / 3) / 10;
    }
  }
  return newArr;
}

/**
 * 足底 60 点 → 16×32 插值帧（`Num2D.jsx:581-588`）。
 *
 * @param {number[]} wsData 60 个采样值。
 * @returns {number[]} 长度 512 的 16×32 帧。
 */
export function applyFootPointLayout(wsData) {
  const newArr = new Array(FOOT_GRID_WIDTH * FOOT_GRID_HEIGHT).fill(0);
  FOOT_60_POINTS.forEach((point, index) => {
    newArr[point[0] * FOOT_GRID_WIDTH + point[1]] = wsData[index];
  });
  return footInterp(newArr, FOOT_60_POINTS);
}

/**
 * 下一个 2 的幂（`Num2Doriginal.jsx:71`）。
 *
 * WebGL 1.0 对 NPOT 纹理有采样限制，`Num2Doriginal` 用它把纹理开到 POT 尺寸，
 * 再靠 `u_texScale` 把 `[0,1]` 映射回真实数据区。
 *
 * @param {number} n 目标尺寸。
 * @returns {number} 不小于 n 的最小 2 的幂。
 */
export function nextPOT(n) {
  let v = 1;
  while (v < n) v <<= 1;
  return v;
}

/**
 * 方阵转置（`Num2Doriginal.jsx:47-57`）。长度不符时原样返回副本。
 *
 * @param {number[]} data 扁平方阵。
 * @param {number} size 边长。
 * @returns {number[]} 转置后的新数组。
 */
export function transposeSquareMatrix(data, size) {
  if (!Array.isArray(data) || data.length !== size * size) {
    return Array.isArray(data) ? [...data] : [];
  }
  return data.map((_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    return data[col * size + row];
  });
}

/**
 * 裸数据归一化（`Num2Doriginal.jsx:59-65`）。
 *
 * 原实现用一张 `RAW_TRANSPOSE_MATRIX_TYPES` 集合按 `matrixName` 判断要不要转置，
 * 这里换成布尔参数 —— 那张集合里只有 `jqbed` 走得到这条通路（`smallBed` 三型
 * 在 `Home.jsx` 更早的分支就进 `numMatrix` 的 sprite3d 后端了）。
 *
 * **只在 `width === height` 时转置**，这是原实现的条件，不是遗漏。
 *
 * @param {number[]} data 原始帧。
 * @param {{transpose?: boolean, width: number, height: number}} options 归一化选项。
 * @returns {number[]} 归一化后的新数组。
 */
export function normalizeRawFrame(data, options) {
  const rawData = Array.isArray(data) ? [...data] : [];
  if (options.transpose && options.width === options.height) {
    return transposeSquareMatrix(rawData, options.width);
  }
  return rawData;
}

/**
 * 按 1 起点的下标表取值（`Num2Doriginal.jsx` 的 `genNewArr`）。
 *
 * 表里写的是「第几个采样点」，所以取的是 `arr[pos - 1]`；非有限值补 0。
 *
 * @param {number[]} arr 原始帧。
 * @param {number[]} positionArr 1 起点的下标表。
 * @returns {number[]} 取出的值，长度与下标表相同。
 */
export function pickByPositions(arr, positionArr) {
  const res = [];
  for (let i = 0; i < positionArr.length; i++) {
    const value = Number(arr[positionArr[i] - 1]);
    res[i] = Number.isFinite(value) ? value : 0;
  }
  return res;
}

/**
 * 把若干分区水平排成一张大图（`Num2Doriginal.jsx` 的 `buildRobotLayout`）。
 *
 * 机器人展示形式把「脑袋 / 前胸 / 左右肩 / 左右臂」当成 6 块独立小矩阵，
 * 这里把它们拼成一整块纹理 + 一张 mask，于是**一次 draw call 画完全部分区**。
 * `layoutH = maxH + 2` 那 2 行是留给分区标题的空白。
 *
 * @param {Array<{w: number, h: number, data: number[]}>} partDefs 各分区。
 * @param {number} gap 分区间距（格）。
 * @returns {{layoutData: Float32Array, maskData: Uint8Array, layoutW: number, layoutH: number, partDefsWithOffset: object[]}} 布局结果。
 */
export function packRobotLayout(partDefs, gap) {
  let offsetX = 0;
  let maxH = 0;
  const partDefsWithOffset = partDefs.map((def) => {
    const result = { ...def, offsetX, offsetY: 0 };
    offsetX += def.w + gap;
    if (def.h > maxH) maxH = def.h;
    return result;
  });
  const layoutW = offsetX - gap;
  const layoutH = maxH + 2;

  const layoutData = new Float32Array(layoutW * layoutH);
  const maskData = new Uint8Array(layoutW * layoutH);

  partDefsWithOffset.forEach((def) => {
    const { offsetX: ox, offsetY: oy, w, h, data } = def;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const layoutIdx = (oy + i) * layoutW + (ox + j);
        const dataIdx = i * w + j;
        layoutData[layoutIdx] = dataIdx < data.length ? data[dataIdx] : 0;
        maskData[layoutIdx] = 255;
      }
    }
  });

  return { layoutData, maskData, layoutW, layoutH, partDefsWithOffset };
}

/** 视口推导用的常量，逐字来自两份原实现（两边完全一致）。 */
export const MATRIX_VIEWPORT = {
  widthRatio: 0.4,
  robotWidthRatio: 0.6,
  sidePanelWidth: 360,
  horizontalPadding: 48,
  verticalPadding: 120,
  minWidth: 240,
  minHeight: 280,
};

/**
 * 由视口尺寸推出矩阵可占的最大宽高（`getMatrixViewportBounds`）。
 *
 * **宽高由调用方传进来，本函数不读 `window`** —— 这是它能留在零依赖层的原因。
 * 也是「渲染器按视口而非按容器定尺寸」那条积压将来的落脚点：把
 * `innerWidth/innerHeight` 换成容器尺寸就够了，公式不用动。
 *
 * @param {{innerWidth?: number, innerHeight?: number, widthRatio?: number}} [options] 视口与宽比。
 * @returns {{maxW: number, maxH: number}} 可用宽高。
 */
export function matrixViewportBounds(options = {}) {
  const ww = Number.isFinite(options.innerWidth) ? options.innerWidth : 1920;
  const wh = Number.isFinite(options.innerHeight) ? options.innerHeight : 1080;
  const widthRatio = Number.isFinite(options.widthRatio)
    ? options.widthRatio
    : MATRIX_VIEWPORT.widthRatio;

  const ratioWidth = Math.floor(ww * widthRatio);
  const availableWidth = Math.max(
    ww - MATRIX_VIEWPORT.sidePanelWidth - MATRIX_VIEWPORT.horizontalPadding,
    160,
  );
  const safeViewportWidth = Math.max(ww - 32, 160);
  const maxW = Math.min(
    safeViewportWidth,
    Math.max(MATRIX_VIEWPORT.minWidth, Math.min(ratioWidth, availableWidth)),
  );

  return {
    maxW,
    maxH: Math.max(MATRIX_VIEWPORT.minHeight, wh - MATRIX_VIEWPORT.verticalPadding),
  };
}

/**
 * 由纹理尺寸与可用宽高算格子边长（`calcCellSize`，两份实现逐字相同）。
 *
 * @param {number} texW 纹理宽（格）。
 * @param {number} texH 纹理高（格）。
 * @param {number} maxW 可用宽（px）。
 * @param {number} maxH 可用高（px）。
 * @param {number} padding 单边留白（px）。
 * @returns {number} 格子边长，下限 8。
 */
export function calcCellSize(texW, texH, maxW, maxH, padding) {
  const availW = maxW - padding * 2;
  const availH = maxH - padding * 2;
  const cellW = Math.floor(availW / texW);
  const cellH = Math.floor(availH / texH);
  return Math.max(8, Math.min(cellW, cellH));
}

/**
 * 机器人分区布局的格子边长（`calcRobotCellSizeFromLayout`）。
 *
 * 与 `calcCellSize` 的差别是三个写死值：留白 60/100 而不是对称 padding，
 * 下限 12 而不是 8，还多一个上限 35。
 *
 * @param {number} layoutW 拼接后的布局宽（格）。
 * @param {number} layoutH 布局高（格）。
 * @param {number} maxW 可用宽（px）。
 * @param {number} maxH 可用高（px）。
 * @returns {number} 格子边长，夹在 [12, 35]。
 */
export function calcRobotCellSize(layoutW, layoutH, maxW, maxH) {
  const availW = maxW - 60;
  const availH = maxH - 100;
  const cellW = Math.floor(availW / layoutW);
  const cellH = Math.floor(availH / layoutH);
  return Math.max(12, Math.min(cellW, cellH, 35));
}
