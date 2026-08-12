/**
 * params.js - 点阵渲染器（pointGrid）参数 schema
 *
 * 参数维度不是设计出来的，是从现有场景组件里实测提炼的：
 *
 * - matCol.jsx 与 carCol.jsx 共 953 行，忽略空白与注释后的净差异
 *   只有两个数字：sitnum1(16 vs 9) 和 sitOrder(2 vs 4)。
 * - gloves.jsx 与 gloves1.jsx 的常量完全相同，净差异只有一张
 *   点位坐标表 —— 对应 manifest 里已有的 coordinateMap / pointOrder。
 *
 * 因此点阵渲染器只需要两类参数：标量几何参数 + 可选点位表。
 */

/**
 * 单通道几何参数默认值。
 *
 * 命名沿用现有场景组件，避免迁移时产生认知负担：
 * num1 对应 sitnum1（高度方向），num2 对应 sitnum2（宽度方向）。
 */
const DEFAULT_CHANNEL = {
  /** 矩阵高度（行数），对应旧代码的 sitnum1 / backnum1 */
  num1: 16,
  /** 矩阵宽度（列数），对应旧代码的 sitnum2 / backnum2 */
  num2: 10,
  /** 插值倍率，对应旧代码的 sitInterp / backInterp */
  interp: 2,
  /** 边缘补边阶数，对应旧代码的 sitOrder / backOrder */
  order: 2,
};

/** 渲染节流帧率，对应旧代码模块级的 var FPS */
const DEFAULT_FPS = 10;

/** 点间距，对应旧代码的 SEPARATION */
const DEFAULT_SEPARATION = 100;

/**
 * 参数取值范围，用于 Builder 的表单校验与用户输入兜底。
 *
 * 上界不是物理限制，而是防止用户误填导致渲染点数爆炸：
 * num1 * interp + order * 2 会直接决定顶点数量。
 */
export const PARAM_RANGES = {
  num1: { min: 1, max: 128 },
  num2: { min: 1, max: 128 },
  interp: { min: 1, max: 8 },
  order: { min: 0, max: 16 },
  fps: { min: 1, max: 120 },
  separation: { min: 1, max: 1000 },
};

function clampInteger(value, fallback, range) {
  // null / undefined / 空串一律视为"未提供"而非 0。
  // Number(null) 和 Number('') 都等于 0 且是有限数，若不先拦掉，
  // 缺省字段会被夹到 range.min，而不是回落到默认值。
  if (value === null || value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < range.min) return range.min;
  if (rounded > range.max) return range.max;
  return rounded;
}

/**
 * 归一化单个通道的几何参数。
 *
 * @param {object} channel 原始通道参数。
 * @param {object} defaults 该通道的默认值。
 * @returns {{ num1: number, num2: number, interp: number, order: number }} 归一化结果。
 */
function normalizeChannel(channel = {}, defaults = DEFAULT_CHANNEL) {
  return {
    num1: clampInteger(channel.num1, defaults.num1, PARAM_RANGES.num1),
    num2: clampInteger(channel.num2, defaults.num2, PARAM_RANGES.num2),
    interp: clampInteger(channel.interp, defaults.interp, PARAM_RANGES.interp),
    order: clampInteger(channel.order, defaults.order, PARAM_RANGES.order),
  };
}

/**
 * 归一化点位表。
 *
 * 点位表来自 manifest 的 coordinateMap / pointOrder，形如 [[x, y], ...]。
 * 非法项直接丢弃而不是抛错——用户手工编辑的 manifest 出现个别坏点时，
 * 应当降级渲染而不是让整个模块加载失败。
 *
 * @param {Array} points 原始点位表。
 * @returns {Array<[number, number]> | null} 归一化点位表，无有效点时返回 null。
 */
function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const normalized = points
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([x, y]) => [Number(x), Number(y)])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return normalized.length > 0 ? normalized : null;
}

/**
 * 归一化点阵渲染器参数。
 *
 * 任何非法输入都会退回默认值而非抛错，保证用户创建的模块
 * 即使参数不完整也能渲染出可见结果。
 *
 * @param {object} params manifest 中的 display.renderers[].params。
 * @returns {object} 归一化后的完整参数。
 */
export function normalizePointGridParams(params = {}) {
  const sit = normalizeChannel(params.sit, DEFAULT_CHANNEL);
  const back = normalizeChannel(params.back, {
    ...DEFAULT_CHANNEL,
    num1: 16,
    num2: 32,
    order: 4,
  });

  return {
    sit,
    back,
    fps: clampInteger(params.fps, DEFAULT_FPS, PARAM_RANGES.fps),
    separation: clampInteger(params.separation, DEFAULT_SEPARATION, PARAM_RANGES.separation),
    points: normalizePoints(params.points),
  };
}

/**
 * 由通道参数推导渲染网格尺寸。
 *
 * 公式取自现有场景组件，逐字保留以保证渲染结果一致：
 *   AMOUNTX = num1 * interp + order * 2
 *   AMOUNTY = num2 * interp + order * 2
 *
 * @param {{ num1: number, num2: number, interp: number, order: number }} channel 通道参数。
 * @returns {{ amountX: number, amountY: number, total: number }} 网格尺寸。
 */
export function deriveGridSize(channel) {
  const amountX = channel.num1 * channel.interp + channel.order * 2;
  const amountY = channel.num2 * channel.interp + channel.order * 2;
  return { amountX, amountY, total: amountX * amountY };
}

/**
 * 从 manifest 的 sensor 段推导点阵参数。
 *
 * 让用户在 Builder 里填过一次矩阵尺寸后，渲染器参数能自动带出默认值，
 * 不必再填一遍。用户显式配置的 params 优先级更高。
 *
 * @param {object} sensor manifest 的 sensor 段。
 * @param {object} params 用户显式配置的渲染器参数。
 * @returns {object} 归一化后的完整参数。
 */
export function paramsFromManifest(sensor = {}, params = {}) {
  const matrix = sensor.matrix || {};
  const inherited = {
    ...params,
    sit: {
      num1: matrix.rows,
      num2: matrix.cols,
      ...(params.sit || {}),
    },
  };
  return normalizePointGridParams(inherited);
}

/**
 * 现有场景组件对应的参数预设。
 *
 * 这两组数字直接抄自 matCol.jsx / carCol.jsx 的常量区，
 * 是参数化前后逐帧一致性验证的基准。
 */
export const LEGACY_PRESETS = {
  matCol: {
    sit: { num1: 16, num2: 10, interp: 2, order: 2 },
    back: { num1: 16, num2: 32, interp: 2, order: 4 },
    fps: 10,
    separation: 100,
  },
  carCol: {
    sit: { num1: 9, num2: 10, interp: 2, order: 4 },
    back: { num1: 16, num2: 32, interp: 2, order: 4 },
    fps: 10,
    separation: 100,
  },
};
