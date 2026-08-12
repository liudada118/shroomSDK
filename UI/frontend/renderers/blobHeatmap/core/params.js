/**
 * renderers/blobHeatmap/core/params.js - Canvas 2D 斑点热力的参数归一化与预设
 *
 * 原实现（`client/src/components/heatmap/canvas.jsx`，460 行）的参数散在三处：
 * 模块级的 `options`（`min` / `max` / `size`）、组件体里那个
 * `if (props.matrixName == 'carCol')` 分支，和 `useEffect` 里写死的
 * `window.innerHeight * 0.6`。这个文件把它们收成一份。
 */

/** 参数的合法区间。 */
export const PARAM_RANGES = {
  dataWidth: { min: 1, max: 512 },
  dataHeight: { min: 1, max: 512 },
  radius: { min: 1, max: 400 },
  max: { min: 1, max: 65535 },
  min: { min: 0, max: 65535 },
  maxOpacity: { min: 0.01, max: 1 },
  alphaFloor: { min: 0, max: 1 },
  canvasScale: { min: 0.05, max: 4 },
};

const DEFAULTS = {
  /** 输入矩阵尺寸。 */
  dataWidth: 32,
  dataHeight: 32,
  /**
   * 圆点半径，像素。原件叫 `options.size`；实际画出来的圆连阴影是
   * `size * 1.5` 那么大（`createCircle` 里 `shadowBlur = size / 2`）。
   */
  radius: 50,
  /**
   * 满值阈值。⚠️ 默认 **600** 是全仓唯一 —— 别处同名的 `carValuej` 都是 200。
   * 原件是 `createThresholdState({ valuej1: 600 }).valuej1`，也就是「localStorage
   * 里有就用存的，没有才 600」。归一化层不读存储，读存储那步留在渲染器里。
   */
  max: 600,
  min: 0,
  /** `colorize` 的 alpha 上限。 */
  maxOpacity: 0.9,
  /**
   * `colorize` 的 alpha **下限**。原件写死 0.7 —— 它是这张图"整体发糊、没有真正
   * 淡色区"的来源。参数化出来但默认不变。
   */
  alphaFloor: 0.7,
  /** 画布边长相对宿主容器短边的倍率，最终不会超过宿主。 */
  canvasScale: 0.6,
  /** 圆点是否带阴影（阴影就是那圈羽化）。 */
  shadow: true,
};

function clampNumber(value, fallback, range) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (!range) return numeric;
  return Math.min(range.max, Math.max(range.min, numeric));
}

/**
 * 归一化一份参数。
 *
 * @param {object} [input] 用户传入的参数，任何字段都可缺省。
 * @returns {object} 每个字段都有值的参数对象。
 */
export function normalizeBlobHeatmapParams(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    dataWidth: clampNumber(source.dataWidth, DEFAULTS.dataWidth, PARAM_RANGES.dataWidth),
    dataHeight: clampNumber(source.dataHeight, DEFAULTS.dataHeight, PARAM_RANGES.dataHeight),
    radius: clampNumber(source.radius, DEFAULTS.radius, PARAM_RANGES.radius),
    max: clampNumber(source.max, DEFAULTS.max, PARAM_RANGES.max),
    min: clampNumber(source.min, DEFAULTS.min, PARAM_RANGES.min),
    maxOpacity: clampNumber(source.maxOpacity, DEFAULTS.maxOpacity, PARAM_RANGES.maxOpacity),
    alphaFloor: clampNumber(source.alphaFloor, DEFAULTS.alphaFloor, PARAM_RANGES.alphaFloor),
    canvasScale: clampNumber(source.canvasScale, DEFAULTS.canvasScale, PARAM_RANGES.canvasScale),
    shadow: source.shadow === undefined ? DEFAULTS.shadow : Boolean(source.shadow),
    gradient: source.gradient || null,
  };
}

/**
 * 预设 —— 就是原件那个 `if (props.matrixName == 'carCol')` 分支的两条边。
 *
 * ⚠️ 原件的分支**改的是模块级的 `options` 对象**，也就是说一旦挂过一次 `carCol`，
 * 同一次会话里后面所有实例的 `max` / `size` 都跟着变成 300 / 100，直到刷新页面。
 * 搬进包之后参数是每实例的，这个"串味"没了 —— 这是本轮 `blobHeatmap` 唯一一处
 * **不是逐像素等同**的行为差异，而且它修的是 bug，不是观感。
 */
export const LEGACY_PRESETS = {
  default: {
    dataWidth: 32,
    dataHeight: 32,
    radius: 50,
    max: 600,
  },
  carCol: {
    dataWidth: 10,
    dataHeight: 9,
    radius: 100,
    max: 300,
  },
};

export default normalizeBlobHeatmapParams;
