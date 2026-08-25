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

// 稀疏实测坐标表的补边与插值。放在公共 core 层而不是本目录，是因为手部点云
// 和数字矩阵将来同样需要它——曲面传感器不是点阵独有的问题。
import {
  expandCoordinateGrid,
  isCoordinateTable,
  toPointTable,
} from '../../../core/coordinateGrid.js';

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
  heightScale: { min: 0, max: 10 },
  colorMax: { min: 1, max: 65535 },
  filterMin: { min: 0, max: 65535 },
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

function clampOptionalNumber(value, range) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < range.min) return range.min;
  if (parsed > range.max) return range.max;
  return parsed;
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
 * 支持三种输入：
 *
 * | 传入 | 处理 |
 * | :--- | :--- |
 * | `[[x, y], ...]` | 平面点位，原样使用 |
 * | `[[x, y, z], ...]` | 第三个分量作为该点**基础高度**，压力在它之上叠加 |
 * | `[{X, Y, Z}, ...]` | 实测坐标表（CAD / 扫描件的原始格式），自动转成元组 |
 *
 * 点位表来自 manifest 的 coordinateMap / pointOrder，或传感器实测导出。
 * 非法项直接丢弃而不是抛错——用户手工编辑的表出现个别坏点时，
 * 应当降级渲染而不是让整个模块加载失败。
 *
 * ⚠️ **这一层不做插值。** 稀疏实测表（16×16=256 条）要先经
 * `core/coordinateGrid.js` 的 `expandCoordinateGrid()` 扩成与渲染网格等长，
 * 否则长度对不上，`buildPointGridBasePositions` 会回落规则矩阵。
 * 渲染器的 `sparsePoints` 参数会自动做这一步。
 *
 * @param {Array} points 原始点位表。
 * @returns {Array<number[]> | null} 归一化点位表，无有效点时返回 null。
 */
function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  const normalized = points
    .map((point) => {
      // 实测坐标表格式。字段常常是字符串，走 Number() 转换。
      if (point && !Array.isArray(point) && typeof point === 'object') {
        const x = Number(point.X);
        const y = Number(point.Y);
        const z = Number(point.Z);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return Number.isFinite(z) ? [x, y, z] : [x, y];
      }
      if (!Array.isArray(point) || point.length < 2) return null;
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      // 第三个分量可选：给了就当基础高度，没给就是平面点位。
      const z = Number(point[2]);
      return Number.isFinite(z) ? [x, y, z] : [x, y];
    })
    .filter(Boolean);

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

  // 稀疏实测表：长度按 sit 的 num1 × num2 校验，扩展后长度自然等于渲染网格。
  // 与 `points` 的分工——`points` 是**已经**和网格等长的密集表，
  // `sparsePoints` 是一个点位一条记录的原始表，由渲染器负责扩展。
  // 两者都给时 `sparsePoints` 优先：它信息更完整，没有被插值过。
  const sparsePoints = isCoordinateTable(params.sparsePoints, sit.num1 * sit.num2)
    ? params.sparsePoints
    : null;

  return {
    sit,
    back,
    fps: clampInteger(params.fps, DEFAULT_FPS, PARAM_RANGES.fps),
    separation: clampInteger(params.separation, DEFAULT_SEPARATION, PARAM_RANGES.separation),
    heightScale: clampOptionalNumber(params.heightScale, PARAM_RANGES.heightScale),
    colorMax: clampOptionalNumber(params.colorMax, PARAM_RANGES.colorMax),
    filterMin: clampOptionalNumber(params.filterMin, PARAM_RANGES.filterMin),
    points: normalizePoints(params.points),
    sparsePoints,
  };
}

/**
 * 解析最终喂给几何体的密集点位表。
 *
 * 优先级：`sparsePoints`（自动扩展）> `points`（已是密集表）> null（规则矩阵）。
 *
 * 放在 core 层而不是 React 层，是因为它是纯的、需要单测，而且非渲染通路
 * （导出、坐标核对）也要拿到同一份结果。
 *
 * @param {object} config 已归一化的参数。
 * @returns {Array<number[]> | null} 密集点位表，无有效点位时为 null。
 */
export function resolvePointGridPoints(config = {}) {
  const channel = config.sit || DEFAULT_CHANNEL;

  if (config.sparsePoints) {
    const expanded = expandCoordinateGrid({
      table: config.sparsePoints,
      rows: channel.num1,
      cols: channel.num2,
      interp: channel.interp,
      order: channel.order,
    });
    // 扩展失败（长度对不上）时不静默回落到 points —— 两张表尺寸不同，
    // 混用会画出一团乱麻。宁可退回规则矩阵，形状明显不对更容易发现。
    if (expanded) return toPointTable(expanded, { includeZ: true });
  }

  return config.points || null;
}

export function resolvePointGridTuning(tuning = {}, params = {}) {
  const normalized = normalizePointGridParams(params);
  return {
    ...tuning,
    value1: normalized.heightScale ?? tuning.value1,
    valuej1: normalized.colorMax ?? tuning.valuej1,
    valuef1: normalized.filterMin ?? tuning.valuef1,
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
