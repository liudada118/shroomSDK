/**
 * renderers/handPoints/core/params.js - 手部点云渲染器（handPoints）参数 schema
 *
 * 参数维度同样是实测提炼的，不是设计出来的：`hand0205Point.jsx`（993 行）与
 * `hand0205Point147.jsx`（1037 行）在归一化空白与注释后净差 **151 行**，其中
 * 真正的差异只有下面这张表里的九个值，外加两块本身就已经抽成模块的东西
 * （点表 → `layout.js`，插值实现 → `pipeline.js`）。
 *
 * | 参数 | `hand0205` | `hand0205_147` |
 * | :--- | :---: | :---: |
 * | `sit.interp` | 2 | 4 |
 * | `sit.order` | 4 | 6 |
 * | `pointSize` | 5/16 | 2/16 |
 * | `particleScale` | 0.0011 ×3 | (0.0005, 0.001, 0.0006) |
 * | `rotationX` | `Math.PI` | `Math.PI - 0.02` |
 * | `maskBlur` | 1.2 | 1.5 |
 * | `maskSource` | `'mask'` | `'value'` |
 * | `hiddenY` | -100000 | -1000 |
 * | `pointTable` / `maskMode` / `interpMode` | gloves | hand147 |
 *
 * ⚠️ **`maskSource` 那一条是真行为差异，不是笔误级别的小差别。** 原实现里
 * `hand0205` 判「这个点是不是手」用的是**掩码**模糊后的值（`bigArrshand`），
 * 147 用的却是**压力**模糊后的值（`bigArrg`）—— 也就是说 147 那条上，掩码算了
 * 一整套（插值 + 补边 + 高斯）却从没参与判定，只有压力低于阈值的点才被藏起来。
 * 搬的时候两种都保留成开关，没有"统一"（统一就是可见的画面变化）。已记积压。
 */

/** 矩阵几何默认值。命名沿用原实现的 `sitnum1` / `sitnum2` / `sitInterp` / `sitOrder`。 */
const DEFAULT_CHANNEL = {
  /** 矩阵高度（行数），原 `sitnum1` */
  num1: 32,
  /** 矩阵宽度（列数），原 `sitnum2` */
  num2: 32,
  /** 插值倍率，原 `sitInterp` */
  interp: 2,
  /** 边缘补边阶数，原 `sitOrder` */
  order: 4,
};

/** 渲染节流帧率，原模块级 `var FPS = 10`（统计上报的节流，不是 rAF 的节流）。 */
const DEFAULT_FPS = 10;

/** 点间距，原 `SEPARATION`。 */
const DEFAULT_SEPARATION = 100;

/**
 * 参数取值范围。上界不是物理限制，是防止误填把顶点数撑爆 ——
 * 顶点数是 `(num1 * interp + order * 2) * (num2 * interp + order * 2)`，
 * 默认预设已经是 72×72 = 5184，147 预设是 140×140 = 19600。
 */
export const PARAM_RANGES = {
  num1: { min: 1, max: 128 },
  num2: { min: 1, max: 128 },
  interp: { min: 1, max: 8 },
  order: { min: 0, max: 16 },
  fps: { min: 1, max: 120 },
  separation: { min: 1, max: 1000 },
  pointSize: { min: 0.001, max: 100 },
  maskBlur: { min: 0, max: 20 },
  hiddenY: { min: -1e9, max: 0 },
  maskThreshold: { min: 0, max: 1e6 },
};

/** `params.maskSource` 的合法取值，见文件头那段警告。 */
export const MASK_SOURCES = ['mask', 'value'];

/**
 * `hand1.glb` 里的骨骼名。逐字搬自 `hand0205Point.jsx:380-404`。
 *
 * ⚠️ **第一根手指（拇指）只有两节，其余四指三节** —— 原实现如此
 * （`Finger_01` / `Finger_02` 没有 `Finger_00`）。取不到的骨骼在旋转时被静默跳过。
 */
export const DEFAULT_FINGER_BONES = [
  ['Finger_01', 'Finger_02'],
  ['Finger_10', 'Finger_11', 'Finger_12'],
  ['Finger_20', 'Finger_21', 'Finger_22'],
  ['Finger_30', 'Finger_31', 'Finger_32'],
  ['Finger_40', 'Finger_41', 'Finger_42'],
];

function clampInteger(value, fallback, range) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < range.min) return range.min;
  if (rounded > range.max) return range.max;
  return rounded;
}

function clampNumber(value, fallback, range) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < range.min) return range.min;
  if (parsed > range.max) return range.max;
  return parsed;
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeVec3(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    const parsed = value.slice(0, 3).map(Number);
    if (parsed.every((n) => Number.isFinite(n))) return parsed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [value, value, value];
  return fallback.slice();
}

/**
 * 归一化手部点云渲染器参数。
 *
 * 与包内其它渲染器一致：任何非法输入退回默认值而不抛错。
 *
 * @param {object} params manifest 中的 `display.renderers[].params`。
 * @returns {object} 归一化后的完整参数。
 */
export function normalizeHandPointsParams(params = {}) {
  const channel = params.sit || {};
  return {
    sit: {
      num1: clampInteger(channel.num1, DEFAULT_CHANNEL.num1, PARAM_RANGES.num1),
      num2: clampInteger(channel.num2, DEFAULT_CHANNEL.num2, PARAM_RANGES.num2),
      interp: clampInteger(channel.interp, DEFAULT_CHANNEL.interp, PARAM_RANGES.interp),
      order: clampInteger(channel.order, DEFAULT_CHANNEL.order, PARAM_RANGES.order),
    },
    fps: clampInteger(params.fps, DEFAULT_FPS, PARAM_RANGES.fps),
    separation: clampInteger(params.separation, DEFAULT_SEPARATION, PARAM_RANGES.separation),

    // —— 点表与管线选路 ——
    pointTable: pickEnum(params.pointTable, ['gloves', 'glovesAlt', 'hand147'], 'gloves'),
    maskMode: pickEnum(params.maskMode, ['gloves', 'hand147'], 'gloves'),
    interpMode: pickEnum(params.interpMode, ['centered', 'ramp'], 'centered'),
    maskSource: pickEnum(params.maskSource, MASK_SOURCES, 'mask'),

    // —— 观感 ——
    pointSize: clampNumber(params.pointSize, 5 / 16, PARAM_RANGES.pointSize),
    particleScale: normalizeVec3(params.particleScale, [0.0011, 0.0011, 0.0011]),
    particlePosition: normalizeVec3(params.particlePosition, [1.5, 1.1, 3]),
    rotationX: Number.isFinite(Number(params.rotationX)) && params.rotationX !== ''
      && params.rotationX !== null && params.rotationX !== undefined
      ? Number(params.rotationX)
      : Math.PI,
    rotationZ: Number.isFinite(Number(params.rotationZ)) && params.rotationZ !== ''
      && params.rotationZ !== null && params.rotationZ !== undefined
      ? Number(params.rotationZ)
      : Math.PI,

    // —— 掩码 ——
    maskBlur: clampNumber(params.maskBlur, 1.2, PARAM_RANGES.maskBlur),
    maskThreshold: clampNumber(params.maskThreshold, 50, PARAM_RANGES.maskThreshold),
    hiddenY: clampNumber(params.hiddenY, -100000, PARAM_RANGES.hiddenY),

    // —— 模型 ——
    // 可选的运行期 URL。SDK 不内置 GLB；未传时只渲染点云。
    modelUrl: typeof params.modelUrl === 'string' ? params.modelUrl : '',
    /** 五指的骨骼名，外层是手指、内层是该指从根到尖的骨节。 */
    fingerBones: Array.isArray(params.fingerBones) && params.fingerBones.length
      ? params.fingerBones
      : DEFAULT_FINGER_BONES,
    /** 关节旋转量的系数：`bone.rotation.z = fingerRotationScale * value`。 */
    fingerRotationScale: clampNumber(
      params.fingerRotationScale,
      -Math.PI / 2,
      { min: -Math.PI * 2, max: Math.PI * 2 },
    ),

    /** 点精灵贴图。留空走包内自带的 `circle.png`（打包资源，不是运行期相对 URL）。 */
    pointSprite: typeof params.pointSprite === 'string' && params.pointSprite
      ? params.pointSprite
      : null,
  };
}

/**
 * 由通道参数推导渲染网格尺寸。公式与 `pointGrid` 相同，逐字取自原实现：
 *   `AMOUNTX = num1 * interp + order * 2`
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
 * 两条预设。数字直接抄自两个原组件的常量区，是逐帧一致性验证的基准。
 *
 * `hand0205Alt` 是第三条，参数与 `hand0205` 完全相同、只换 `pointTable` ——
 * 它对应原实现里那行注释掉的 `glovesPoints = glovesPoints1`，见
 * [layout.js](layout.js) 的文件头。**没有 `matrixName` 会解析到它**，是给二开者
 * 手动选的。
 */
export const LEGACY_PRESETS = {
  hand0205: {
    sit: { num1: 32, num2: 32, interp: 2, order: 4 },
    fps: 10,
    separation: 100,
    pointTable: 'gloves',
    maskMode: 'gloves',
    interpMode: 'centered',
    maskSource: 'mask',
    pointSize: 5 / 16,
    particleScale: [0.0011, 0.0011, 0.0011],
    particlePosition: [1.5, 1.1, 3],
    rotationX: Math.PI,
    rotationZ: Math.PI,
    maskBlur: 1.2,
    maskThreshold: 50,
    hiddenY: -100000,
  },
  hand0205Alt: {
    sit: { num1: 32, num2: 32, interp: 2, order: 4 },
    fps: 10,
    separation: 100,
    pointTable: 'glovesAlt',
    maskMode: 'gloves',
    interpMode: 'centered',
    maskSource: 'mask',
    pointSize: 5 / 16,
    particleScale: [0.0011, 0.0011, 0.0011],
    particlePosition: [1.5, 1.1, 3],
    rotationX: Math.PI,
    rotationZ: Math.PI,
    maskBlur: 1.2,
    maskThreshold: 50,
    hiddenY: -100000,
  },
  hand0205_147: {
    sit: { num1: 32, num2: 32, interp: 4, order: 6 },
    fps: 10,
    separation: 100,
    pointTable: 'hand147',
    maskMode: 'hand147',
    interpMode: 'ramp',
    maskSource: 'value',
    pointSize: 2 / 16,
    particleScale: [0.0005, 0.001, 0.0006],
    particlePosition: [1.5, 1.1, 3],
    rotationX: Math.PI - 0.02,
    rotationZ: Math.PI,
    maskBlur: 1.5,
    maskThreshold: 50,
    hiddenY: -1000,
  },
};
