/**
 * coordinateGrid.js - 稀疏物理坐标表的补边与插值
 *
 * ## 解决的问题
 *
 * 传感器的物理点位往往**不是规则网格**：座椅坐垫是弧面、鞋垫是脚型、靠背带曲率。
 * 这些形状用 `separation` 铺出来的等距网格表达不了，只能给一张实测坐标表。
 *
 * 但实测表是**稀疏**的（一个点位一条记录，16×16 = 256 条），而点阵渲染器要画的是
 * **插值后的密集网格**（(16+order×2)×interp 见方，几千个点）。中间这一步——把稀疏
 * 坐标表扩成密集坐标表——原先散在场景组件里，本文件把它提成纯函数。
 *
 * 逐字对应 `client/src/components/three/carQXFbx.jsx` 的 `objdupli()`：
 *
 * ```js
 * const newObj = objAddOrder(obj, row, col, 1)          // 补边
 * const res = rowInterp(newObj, row + order*2, col + order*2, interp)  // 双线性插值
 * ```
 *
 * ⚠️ **本文件刻意改了这两步的顺序：先插值，再补边。**
 *
 * 原实现是「先补边再插值」，得到 `(rows + order*2) * interp` 个点。但压力管线
 * （`pointGrid/core/pipeline.js` 的 `runPointGridPipeline`）走的是
 * `interpSmall → addSide`，也就是**先插值再补边**，得到 `rows * interp + order*2` 个点
 * ——这正是 `deriveGridSize()` 的公式。
 *
 * 两种顺序的点数不同（16×16 / interp 2 / order 4：原顺序 48×48=2304，
 * 管线顺序 40×40=1600）。坐标表必须与压力网格**逐点对齐**，否则第 N 个压力值
 * 会被画到第 N 个坐标上，而这两个 N 指的不是同一个物理点位——整张图会错乱。
 * 所以这里跟随压力管线的顺序，而不是原组件的顺序。
 *
 * 原实现之所以没暴露这个问题，是因为它自己那条通路里坐标和压力用的是同一套
 * 「先补边」尺寸；搬进 SDK 后要和既有压力管线对接，就必须对齐到后者。
 *
 * ## 与 `coordinatePointLayout.js` 的分工
 *
 * | 文件 | 输入 | 输出 | 用途 |
 * | :--- | :--- | :--- | :--- |
 * | `coordinatePointLayout.js` | 二维嵌套 `[[[x,y],...],...]` | SVG / 世界坐标布局 | 2D 预览与 numMatrix |
 * | 本文件 | 扁平 `[{X,Y,Z},...]` | 扁平 `[{X,Y,Z},...]`（更密） | 点阵插值前的坐标扩展 |
 *
 * 两者输入格式不同不是随意的：`{X,Y,Z}` 是实测导出的原始格式（CAD / 扫描件里
 * 就长这样），要求使用方先转成嵌套数组等于让他们多写一层转换。本文件另外提供
 * `toPointTable()` 把结果转成点阵渲染器认的 `[x, y]` / `[x, y, z]`。
 */

/** 缺省点。补边越界时读到它，而不是 undefined。 */
const ZERO_POINT = { X: 0, Y: 0, Z: 0 };

/**
 * 读一个数值字段。
 *
 * 实测坐标表**常常是字符串**（`{"X": "3528.39870618"}` —— 原项目的 `sitObj`
 * 就是这样），所以必须走 `Number()` 而不是直接用。非有限值归零而不抛错：
 * 一张几百点的手工表里有个别坏点时，应当降级渲染而不是整块画不出来。
 *
 * @param {object} point 坐标点。
 * @param {'X'|'Y'|'Z'} key 字段名。
 * @returns {number} 有限数值，取不到时为 0。
 */
function readAxis(point, key) {
  const value = Number(point?.[key]);
  return Number.isFinite(value) ? value : 0;
}

/**
 * 判断是否是可用的稀疏坐标表。
 *
 * 只要求「是数组、非空、每项是对象且 X/Y 可转成有限数」。Z 缺省允许——
 * 平面传感器的实测表经常只导出两轴。
 *
 * @param {unknown} table 待判定的坐标表。
 * @param {number} [expectedLength] 期望长度；给了就一并校验。
 * @returns {boolean} 是否可用。
 */
export function isCoordinateTable(table, expectedLength) {
  if (!Array.isArray(table) || table.length === 0) return false;
  if (expectedLength !== undefined && table.length !== expectedLength) return false;
  return table.every((point) => (
    point !== null
    && typeof point === 'object'
    && Number.isFinite(Number(point.X))
    && Number.isFinite(Number(point.Y))
  ));
}

/**
 * 给坐标表补边。
 *
 * 逐字对应 `assets/util/line.js` 的 `objAddOrder`：向四周各扩 `order` 圈，
 * 越界处**夹取最近的边缘点**（不是补零）——补零会在边缘拉出一片塌到原点的
 * 假点，夹取则让边缘点位重复，插值后表现为形状自然延伸。
 *
 * @param {Array<{X:number,Y:number,Z:number}>} table 稀疏坐标表，row-major。
 * @param {number} rows 原始行数。
 * @param {number} cols 原始列数。
 * @param {number} [order=1] 补边圈数。
 * @returns {Array<{X:number,Y:number,Z:number}>} 长度 `(rows+order*2) * (cols+order*2)`。
 */
export function padCoordinateTable(table, rows, cols, order = 1) {
  const source = Array.isArray(table) ? table : [];
  const result = [];

  const readPoint = (row, col) => {
    const clampedRow = Math.min(rows - 1, Math.max(0, row));
    const clampedCol = Math.min(cols - 1, Math.max(0, col));
    return source[clampedRow * cols + clampedCol] || ZERO_POINT;
  };

  for (let row = -order; row < rows + order; row += 1) {
    for (let col = -order; col < cols + order; col += 1) {
      const point = readPoint(row, col);
      result.push({
        X: readAxis(point, 'X'),
        Y: readAxis(point, 'Y'),
        Z: readAxis(point, 'Z'),
      });
    }
  }

  return result;
}

/**
 * 对坐标表做双线性插值加密。
 *
 * 逐字对应 `assets/util/line.js` 的 `rowInterp`。三个轴各自独立插值，所以曲面
 * 传感器的 Z 起伏会跟着一起加密，不会因为插值变成折线。
 *
 * 注意**参数顺序是 `(width, height)`**，也就是 `(cols, rows)` —— 与原实现一致。
 *
 * @param {Array<{X:number,Y:number,Z:number}>} table 坐标表，row-major。
 * @param {number} width 当前列数。
 * @param {number} height 当前行数。
 * @param {number} [interp=2] 加密倍率。
 * @returns {Array<{X:number,Y:number,Z:number}>} 长度 `width*interp * height*interp`。
 */
export function interpolateCoordinateTable(table, width, height, interp = 2) {
  const source = Array.isArray(table) ? table : [];
  const nextWidth = width * interp;
  const nextHeight = height * interp;
  const result = new Array(nextWidth * nextHeight);

  const readPoint = (row, col) => {
    const clampedRow = Math.min(height - 1, Math.max(0, row));
    const clampedCol = Math.min(width - 1, Math.max(0, col));
    return source[clampedRow * width + clampedCol] || ZERO_POINT;
  };

  for (let row = 0; row < nextHeight; row += 1) {
    for (let col = 0; col < nextWidth; col += 1) {
      const sourceRow = row / interp;
      const sourceCol = col / interp;
      const row0 = Math.floor(sourceRow);
      const col0 = Math.floor(sourceCol);
      const row1 = Math.min(height - 1, row0 + 1);
      const col1 = Math.min(width - 1, col0 + 1);
      const weightRow = sourceRow - row0;
      const weightCol = sourceCol - col0;

      const p00 = readPoint(row0, col0);
      const p10 = readPoint(row1, col0);
      const p01 = readPoint(row0, col1);
      const p11 = readPoint(row1, col1);

      const mix = (key) => (
        readAxis(p00, key) * (1 - weightRow) * (1 - weightCol)
        + readAxis(p10, key) * weightRow * (1 - weightCol)
        + readAxis(p01, key) * (1 - weightRow) * weightCol
        + readAxis(p11, key) * weightRow * weightCol
      );

      result[row * nextWidth + col] = { X: mix('X'), Y: mix('Y'), Z: mix('Z') };
    }
  }

  return result;
}

/**
 * 把稀疏坐标表扩成与渲染网格等长的密集坐标表。
 *
 * 这是本文件的主入口。顺序是**先插值、再补边**，与压力管线
 * （`interpSmall → addSide`）一致，因此输出长度**恰好等于** `deriveGridSize()`
 * 的 `total`（`rows * interp + order * 2` 见方），可以直接喂给点阵渲染器，
 * 且第 N 个坐标与第 N 个压力值指向同一个物理点位。见文件头的顺序说明。
 *
 * @param {object} options 扩展参数。
 * @param {Array<{X:number,Y:number,Z:number}>} options.table 稀疏坐标表。
 * @param {number} options.rows 原始行数（对应 `num1`）。
 * @param {number} options.cols 原始列数（对应 `num2`）。
 * @param {number} [options.interp=2] 加密倍率（对应 `interp`）。
 * @param {number} [options.order=1] 补边圈数（对应 `order`）。
 * @returns {Array<{X:number,Y:number,Z:number}> | null} 密集坐标表；输入不可用时为 null。
 */
export function expandCoordinateGrid({
  table,
  rows,
  cols,
  interp = 2,
  order = 1,
}) {
  const safeRows = Math.max(1, Math.round(Number(rows) || 0));
  const safeCols = Math.max(1, Math.round(Number(cols) || 0));
  const safeInterp = Math.max(1, Math.round(Number(interp) || 1));
  const safeOrder = Math.max(0, Math.round(Number(order) || 0));

  // 长度对不上就直接退回 null，让渲染器回落规则矩阵 —— 用一张行列数不符的
  // 坐标表插值出来的是一团乱麻，比退回等距网格更难排查。
  if (!isCoordinateTable(table, safeRows * safeCols)) return null;

  // 先插值：稀疏点位加密到 (cols*interp) × (rows*interp)。
  const interpolated = interpolateCoordinateTable(table, safeCols, safeRows, safeInterp);

  // 再补边：与 addSide 对齐，得到 rows*interp + order*2 见方。
  return padCoordinateTable(
    interpolated,
    safeRows * safeInterp,
    safeCols * safeInterp,
    safeOrder,
  );
}

/**
 * 把 `{X,Y,Z}` 坐标表转成点阵渲染器认的元组表。
 *
 * 渲染器的 `points` 参数收 `[x, y]`（平面）或 `[x, y, z]`（带基础高度）。
 * 带 Z 的形式让曲面传感器的起伏成为点的初始高度，压力值在它之上叠加。
 *
 * @param {Array<{X:number,Y:number,Z:number}>} table 坐标表。
 * @param {object} [options] 转换选项。
 * @param {boolean} [options.includeZ=false] 是否输出第三个分量。
 * @returns {Array<number[]>} 元组表；输入不可用时为空数组。
 */
export function toPointTable(table, { includeZ = false } = {}) {
  if (!isCoordinateTable(table)) return [];
  return table.map((point) => (includeZ
    ? [readAxis(point, 'X'), readAxis(point, 'Y'), readAxis(point, 'Z')]
    : [readAxis(point, 'X'), readAxis(point, 'Y')]));
}
