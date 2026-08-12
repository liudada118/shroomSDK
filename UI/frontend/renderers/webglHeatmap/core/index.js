/**
 * renderers/webglHeatmap/core/index.js - 斑点热力渲染器的纯逻辑出口
 *
 * 与另外三个 `core/<renderer>/index.js` 同一套划分：参数 schema、帧运算、
 * 着色器源码在这一层，**没有 React、没有 three、没有 DOM**。
 *
 * 着色器进 `core/` 这件事值得说一句：它们只是字符串，`gl` 一次都没出现，
 * 所以裸 Node 能 import，`smoke-core.mjs` 因此可以对**发出来的色带 GLSL**
 * 做断言 —— 色带来自 `../colormaps.js` 的 `HEAT_BLOB_STOPS` 发码，不是手抄的
 * 第二份。真正拿它们去编译的是 `../../renderers/webglHeatmap/react/blobs.js`。
 */

export {
  LEGACY_PRESETS,
  PARAM_RANGES,
  normalizeWebglHeatmapParams,
} from './params.js';

export {
  applyFloor,
  buildHeatPoints,
  clearEdges,
  frameStats,
  mirrorRows,
  prepareFrame,
  pushWindow,
} from './pipeline.js';

export {
  BLOB_ALPHA_CUTOFF,
  BLOB_FRAGMENT_SHADER,
  BLOB_VERTEX_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
  COMPOSITE_VERTEX_SHADER,
  buildCompositeFragmentShader,
} from './shaders.js';
