/**
 * renderers/numMatrix/core/index.js - 数字矩阵渲染器的纯逻辑出口
 *
 * 参数 schema、帧管线、点位铺排、分区布局和着色器源码生成都在这一层，
 * **没有 React、没有 three、没有 DOM**，所以它能在裸 Node 里被 import
 * （`scripts/smoke-core.mjs` 守着这条性质）。真正画画的那部分在
 * `../../renderers/numMatrix/react/`。
 *
 * 着色器源码算纯逻辑：`shaders.js` 发的是**字符串**，拿 `gl` 对象去编译它是
 * `renderers/shared/webgl/glUtil.js` 的事。这条界线让 `shaders.test.js` 能在没有 GL
 * 上下文的环境里逐行比对两份原实现的 GLSL。
 *
 * 这个划分不是审美：`pipeline.js` 之所以能和三份原实现做 785 点逐点比对
 * （`pipeline.test.js`），正因为它是纯的。同一个性质让它能进零依赖层 ——
 * 一个性质两个收益。
 */

export {
  BACKENDS,
  LEGACY_PRESETS,
  PARAM_RANGES,
  TEXTURE_CELL_SIZE,
  deriveGrid,
  normalizeNumMatrixParams,
  paramsFromManifest,
} from './params.js';

export {
  FOOT_60_POINTS,
  FOOT_GRID_HEIGHT,
  FOOT_GRID_WIDTH,
  GLOVE_147_BASE,
  GLOVE_147_PADDED,
  GLOVE_147_POINTS,
  GLOVE_147_THUMB_ROWS_CANVAS2D,
  GLOVE_147_THUMB_ROWS_WEBGL,
  MATRIX_VIEWPORT,
  applyFootPointLayout,
  applyGlove147Layout,
  calcCellSize,
  calcRobotCellSize,
  footInterp,
  matrixViewportBounds,
  nextPOT,
  normalizeRawFrame,
  packRobotLayout,
  padGlove147Rows,
  pickByPositions,
  placeGloveRegion,
  transposeSquareMatrix,
} from './layouts.js';

export {
  ROBOT_LAYOUTS,
  ROBOT_LAYOUT_GAP,
  ROBOT_LAYOUT_NAMES,
  buildRobotFrame,
  getRobotLayout,
} from './robotLayouts.js';

export {
  FRAGMENT_VARIANTS,
  QUAD_POSITIONS,
  QUAD_TEX_COORDS,
  VERTEX_SHADER_SRC,
  buildFragmentShader,
} from './shaders.js';

export {
  applyFloorFilter,
  cellUvOffset,
  classicTint,
  clampTextureValue,
  computeFrameStats,
  createRollingWindow,
  deriveCellPlaneSize,
  deriveWorldCellSize,
  formatDisplayValue,
  getTextureCanvasSize,
  getTextureFontSize,
  getTextureRange,
  instanceWorldPosition,
  quantizeFrame,
  resolveCanvasSize,
} from './pipeline.js';
