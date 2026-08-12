/**
 * renderers/handPoints/core/index.js - 手部点云渲染器的纯逻辑出口
 *
 * 与 `../pointGrid/index.js` 同一套划分：参数 schema、点表与掩码、插值实现、
 * 四元数代数在这一层，**没有 React、没有 three、没有 DOM**，所以能在裸 Node
 * 里被 import（`scripts/smoke-core.mjs` 守着这条性质）。画画的那部分在
 * `../../renderers/handPoints/react/`。
 *
 * 这一层能纯到什么程度，看 `quaternion.js` 就知道：原实现用的是
 * `THREE.Quaternion`，但只用到 `clone` / `invert` / `multiplyQuaternions` /
 * `lengthSq` 四个方法，手写十几行换来了「可以在裸 Node 里逐点测」。
 */

export {
  DEFAULT_FINGER_BONES,
  LEGACY_PRESETS,
  MASK_SOURCES,
  PARAM_RANGES,
  deriveGridSize,
  normalizeHandPointsParams,
} from './params.js';

export {
  GLOVES_POINTS,
  GLOVES_POINTS_ALT,
  HAND_POINT_ARR_147,
  MASK_MODES,
  MASK_VALUE,
  POINT_TABLES,
  buildGlovesMask,
  buildHandPointMask147,
} from './layout.js';

export {
  INTERP_MODES,
  interpCentered,
  interpRamp,
} from './pipeline.js';

export {
  createQuaternionTracker,
  identityQuaternion,
  invertQuaternion,
  lengthSq,
  multiplyQuaternions,
} from './quaternion.js';
