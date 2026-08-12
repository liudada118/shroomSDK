/**
 * renderers/pointGrid/core/index.js - 点阵热力渲染器的纯逻辑出口
 *
 * 与 `../numMatrix/index.js` 同一套划分：参数 schema 与帧管线在这一层，
 * **没有 React、没有 three、没有 DOM**，所以能在裸 Node 里被 import
 * （`scripts/smoke-core.mjs` 守着这条性质）。画画的那部分在
 * `../../renderers/pointGrid/react/`。
 *
 * 这一层的存在感来自 `pipeline.test.js`：它把管线输出与 matCol.jsx /
 * carCol.jsx 里原实现的逐点结果对了 5 组随机帧 × 3 档模糊半径。
 * 能这么对，正因为管线是纯的 —— 不用起 Electron、不用建 WebGL 上下文。
 */

export {
  LEGACY_PRESETS,
  PARAM_RANGES,
  deriveGridSize,
  normalizePointGridParams,
  paramsFromManifest,
} from './params.js';

export {
  buildPointGridBasePositions,
  createPointGridPipeline,
  runPointGridPipeline,
} from './pipeline.js';
