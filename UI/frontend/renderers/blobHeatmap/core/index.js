/**
 * renderers/blobHeatmap/core/index.js - Canvas 2D 斑点热力的纯逻辑出口
 *
 * 三块：参数（`params.js`）、帧运算（`pipeline.js`）、调色板（`intensity.js`）。
 * 三块都能在裸 Node 里 `import` —— `intensity.js` 虽然要一张画布，但画布是**调用时**
 * 才注入/创建的，import 本身不碰 `document`。
 */

export {
  LEGACY_PRESETS,
  PARAM_RANGES,
  normalizeBlobHeatmapParams,
} from './params.js';

export {
  buildBlobPoints,
  frameStats,
  groupByAlpha,
} from './pipeline.js';

export {
  GRADIENT_STOPS,
  PALETTE_SIZE,
  colorize,
  createIntensity,
} from './intensity.js';
