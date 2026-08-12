/**
 * renderers/webglHeatmap/core/params.js - 斑点热力的参数归一化与预设
 *
 * `webglHeatmap` 的原实现（`components/webgl/Canvas4096WebGL.jsx`，187 行）几乎
 * 没有参数：矩阵 64×64、画布 1024×1024、点半径 24、数值 ×1.8、边缘清零窗口
 * `[6, 58]`、左右镜像 —— **全部写死在 `renderFrame` 和 `genWebglHeatmap` 里**。
 * 二开换一块 32×32 的垫子就得改包内源码。这个文件把它们变成参数。
 *
 * 归一化后所有字段都有值，渲染器不用再写 `?? 默认值`。
 */

/**
 * 参数的合法区间。上界不是物理限制，是防止一帧铺出几百万个点把 GPU 打死
 * （点数 = `dataWidth * dataHeight`，每个点画一个直径 `radius * 2` 的圆）。
 */
export const PARAM_RANGES = {
  dataWidth: { min: 1, max: 512 },
  dataHeight: { min: 1, max: 512 },
  canvasWidth: { min: 16, max: 4096 },
  canvasHeight: { min: 16, max: 4096 },
  radius: { min: 1, max: 256 },
  max: { min: 1, max: 65535 },
  filter: { min: 0, max: 65535 },
  valueScale: { min: 0, max: 100 },
  blurFactor: { min: 0.01, max: 1 },
  chartWindow: { min: 2, max: 600 },
};

const DEFAULTS = {
  /** 输入矩阵尺寸。 */
  dataWidth: 64,
  dataHeight: 64,
  /** 离屏画布尺寸（点坐标就铺在这个尺寸上）。 */
  canvasWidth: 1024,
  canvasHeight: 1024,
  /** 每个数据点画多大的圆，像素。 */
  radius: 24,
  /** 满值阈值：`>= max` 的点 alpha 给满。对应侧栏 `valuej` 滑块。 */
  max: 200,
  /** 下限：`< filter` 的点归零。对应侧栏 `valuef` 滑块。 */
  filter: 0,
  /**
   * 铺点时的数值缩放。原件写死 `* 1.8` —— 它和 `max` 是一对，等价于把满值
   * 阈值降到 `max / 1.8`。两个都留着是因为侧栏滑块调的是 `max`，而 1.8 是
   * 出厂标定，二者语义不同。
   */
  valueScale: 1.8,
  /** 圆点的实心区占半径的比例，其余线性羽化。着色器默认 0.55。 */
  blurFactor: 0.55,
  /**
   * 边缘清零窗口：`[keepFrom, keepTo]` 之外的行列置 0。传 `null` 关掉。
   * ⚠️ 默认值 `{6, 58}` 对 64 来说不对称（上切 6 下切 5），见
   * `./pipeline.js` 的 `clearEdges` 说明 —— 那是现在屏幕上的样子。
   */
  edgeClear: { keepFrom: 6, keepTo: 58 },
  /** 左右镜像。 */
  mirrorX: true,
  /** 喂进来的帧至少要这么长才认，短了整帧丢弃（原件写死 4096）。 */
  minFrameLength: 4096,
  /** 两条曲线的滑窗长度。 */
  chartWindow: 20,
  /** 画布在页面上的显示边长（CSS 值）。 */
  displaySize: '80vh',
  /** 容器背景。 */
  background: '#000',
};

function clampNumber(value, fallback, range) {
  // ⚠️ `Number(null)` 和 `Number('')` 都是 0，会被当成"用户传了 0"然后夹到区间
  // 下界 —— `radius: null` 变成 1 而不是默认的 24。先把这三种"没给"挡掉。
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (!range) return numeric;
  return Math.min(range.max, Math.max(range.min, numeric));
}

function normalizeEdgeClear(value) {
  if (value === null || value === false) return null;
  if (!value || typeof value !== 'object') return { ...DEFAULTS.edgeClear };
  const keepFrom = clampNumber(value.keepFrom, DEFAULTS.edgeClear.keepFrom);
  const keepTo = clampNumber(value.keepTo, DEFAULTS.edgeClear.keepTo);
  return { keepFrom, keepTo };
}

/**
 * 归一化一份参数。
 *
 * @param {object} [input] 用户传入的参数，任何字段都可缺省。
 * @returns {object} 每个字段都有值的参数对象。
 */
export function normalizeWebglHeatmapParams(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    dataWidth: clampNumber(source.dataWidth, DEFAULTS.dataWidth, PARAM_RANGES.dataWidth),
    dataHeight: clampNumber(source.dataHeight, DEFAULTS.dataHeight, PARAM_RANGES.dataHeight),
    canvasWidth: clampNumber(source.canvasWidth, DEFAULTS.canvasWidth, PARAM_RANGES.canvasWidth),
    canvasHeight: clampNumber(
      source.canvasHeight, DEFAULTS.canvasHeight, PARAM_RANGES.canvasHeight,
    ),
    radius: clampNumber(source.radius, DEFAULTS.radius, PARAM_RANGES.radius),
    max: clampNumber(source.max, DEFAULTS.max, PARAM_RANGES.max),
    filter: clampNumber(source.filter, DEFAULTS.filter, PARAM_RANGES.filter),
    valueScale: clampNumber(source.valueScale, DEFAULTS.valueScale, PARAM_RANGES.valueScale),
    blurFactor: clampNumber(source.blurFactor, DEFAULTS.blurFactor, PARAM_RANGES.blurFactor),
    edgeClear: normalizeEdgeClear(
      Object.prototype.hasOwnProperty.call(source, 'edgeClear')
        ? source.edgeClear
        : DEFAULTS.edgeClear,
    ),
    mirrorX: source.mirrorX === undefined ? DEFAULTS.mirrorX : Boolean(source.mirrorX),
    minFrameLength: clampNumber(source.minFrameLength, DEFAULTS.minFrameLength),
    chartWindow: clampNumber(source.chartWindow, DEFAULTS.chartWindow, PARAM_RANGES.chartWindow),
    displaySize: source.displaySize || DEFAULTS.displaySize,
    background: source.background || DEFAULTS.background,
  };
}

/**
 * 预设。
 *
 * - `bed4096` 是**唯一的迁移预设** —— 逐字等于 `Canvas4096WebGL` 现在的行为，
 *   主应用两个渲染点都用它。
 * - `plain` 不对应任何原实现，是给二开的起点：喂什么画什么，不清边、不镜像、
 *   不缩放。新增预设不改任何既有画面。
 */
export const LEGACY_PRESETS = {
  bed4096: {
    dataWidth: 64,
    dataHeight: 64,
    canvasWidth: 1024,
    canvasHeight: 1024,
    radius: 24,
    max: 200,
    filter: 0,
    valueScale: 1.8,
    edgeClear: { keepFrom: 6, keepTo: 58 },
    mirrorX: true,
    minFrameLength: 4096,
  },
  plain: {
    dataWidth: 32,
    dataHeight: 32,
    canvasWidth: 512,
    canvasHeight: 512,
    radius: 18,
    max: 200,
    filter: 0,
    valueScale: 1,
    edgeClear: null,
    mirrorX: false,
    minFrameLength: 1,
  },
};

export default normalizeWebglHeatmapParams;
