import {
  LEGACY_PRESETS as BLOB_HEATMAP_PRESETS,
  normalizeBlobHeatmapParams,
} from '../renderers/blobHeatmap/core/params.js';
import {
  LEGACY_PRESETS as NUM_MATRIX_PRESETS,
  normalizeNumMatrixParams,
} from '../renderers/numMatrix/core/params.js';
import {
  LEGACY_PRESETS as POINT_GRID_PRESETS,
  normalizePointGridParams,
} from '../renderers/pointGrid/core/params.js';
import {
  LEGACY_PRESETS as WEBGL_HEATMAP_PRESETS,
  normalizeWebglHeatmapParams,
} from '../renderers/webglHeatmap/core/params.js';

/**
 * 面向配置页面的矩阵展示形式目录。
 *
 * 这里仅描述“用户想看到什么”，渲染器的底层参数由
 * createMatrixDisplayRenderers 根据矩阵和坐标文件统一生成。
 */
export const MATRIX_DISPLAY_MODES = Object.freeze([
  {
    id: 'shape-heatmap-2d',
    rendererId: 'heatmap',
    label: '2D 热力图',
    description: '按传感器坐标形状显示颜色分布',
    dimension: '2d',
    kind: 'heatmap',
    shapeAware: true,
  },
  {
    id: 'shape-values-2d',
    rendererId: 'matrix',
    label: '2D 数字',
    description: '按传感器坐标形状显示每个点的数值',
    dimension: '2d',
    kind: 'values',
    shapeAware: true,
  },
  {
    id: 'matrix-points-3d',
    rendererId: 'pointGrid',
    label: '3D 点图',
    description: '点位坐标决定形状，数值决定点的高度和颜色',
    dimension: '3d',
    kind: 'points',
    shapeAware: true,
  },
  {
    id: 'matrix-values-3d',
    rendererId: 'numMatrix',
    label: '3D 数字',
    description: '以可旋转的三维数字矩阵显示每个点',
    dimension: '3d',
    kind: 'values',
    shapeAware: false,
  },
  {
    id: 'soft-heatmap-2d',
    rendererId: 'blobHeatmap',
    label: '柔和热力图',
    description: '将矩阵点融合成连续的平面热力分布',
    dimension: '2d',
    kind: 'heatmap',
    shapeAware: false,
  },
]);

const MODE_BY_ID = new Map(MATRIX_DISPLAY_MODES.map((mode) => [mode.id, mode]));
const MODE_BY_RENDERER_ID = new Map(
  MATRIX_DISPLAY_MODES.map((mode) => [mode.rendererId, mode]),
);

function positiveInteger(value, fallback = 1) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** 将二维坐标矩阵压平成与帧数据一致的 row-major 点位表。 */
function flattenCoordinateMap(coordinateMap) {
  const coordinates = Array.isArray(coordinateMap)
    ? coordinateMap
    : coordinateMap?.coordinates;
  if (!Array.isArray(coordinates)) return null;

  const points = coordinates.flatMap((row) => (
    Array.isArray(row)
      ? row.map((point) => [Number(point?.[0]), Number(point?.[1])])
      : []
  ));
  return points.length && points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    ? points
    : null;
}

export function getMatrixDisplayMode(modeId) {
  return MODE_BY_ID.get(modeId) || null;
}

export function inferMatrixDisplayModeId(rendererId) {
  return MODE_BY_RENDERER_ID.get(rendererId)?.id || MATRIX_DISPLAY_MODES[0].id;
}

/**
 * 根据矩阵定义生成所有展示形式的渲染器描述。
 *
 * @param {object} options 传感器矩阵上下文。
 * @param {{rows?: number, cols?: number, width?: number, height?: number}} options.matrix 矩阵尺寸。
 * @param {object|Array} [options.coordinateMap] 物理点位坐标矩阵。
 * @returns {Array<object>} 可直接写入 display.renderers 的描述列表。
 */
export function createMatrixDisplayRenderers({ matrix = {}, coordinateMap = null } = {}) {
  const rows = positiveInteger(matrix.rows || matrix.height);
  const cols = positiveInteger(matrix.cols || matrix.width);
  const points = flattenCoordinateMap(coordinateMap);

  return MATRIX_DISPLAY_MODES.map((mode) => {
    let params = {};
    if (mode.rendererId === 'pointGrid') {
      params = {
        sit: { num1: rows, num2: cols, interp: 1, order: 0 },
        back: { num1: rows, num2: cols, interp: 1, order: 0 },
        ...(points?.length === rows * cols ? { points } : {}),
      };
    } else if (mode.rendererId === 'numMatrix') {
      params = {
        backend: 'sprite3d',
        gridWidth: cols,
        gridHeight: rows,
        manageSidebar: false,
      };
    } else if (mode.rendererId === 'blobHeatmap') {
      params = {
        dataWidth: cols,
        dataHeight: rows,
      };
    }

    return {
      id: mode.rendererId,
      type: mode.rendererId,
      label: mode.label,
      description: mode.description,
      params,
    };
  });
}

/** 生成用于检查行列方向和点位顺序的一帧 1..N 数据。 */
export function createDirectionCheckFrame(length) {
  const count = Math.max(0, Math.round(Number(length)) || 0);
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** SDK 内可以直接接收规则矩阵的一组通用渲染器。 */
export const BUILTIN_MATRIX_RENDERER_OPTIONS = Object.freeze([
  { id: 'numMatrix', label: '数字矩阵' },
  { id: 'pointGrid', label: '点阵热力（3D）' },
  { id: 'webglHeatmap', label: '斑点热力（WebGL）' },
  { id: 'blobHeatmap', label: '柔和热力（Canvas 2D）' },
]);

/**
 * 根据同一份矩阵定义生成内置渲染器参数。
 *
 * 这个入口用于配置页和产品实验室：调用方只维护行列、坐标和量程，不需要理解每个
 * 渲染器历史预设里不同的字段名。返回值可直接传给 `RendererHost.params`。
 *
 * @param {string} rendererId 内置矩阵渲染器 id。
 * @param {object} options 矩阵输入。
 * @param {{rows?: number, cols?: number, width?: number, height?: number}} options.matrix 行列定义。
 * @param {object|Array} [options.coordinateMap] rows × cols × [x, y] 坐标矩阵。
 * @param {number} [options.valueMax] 当前数据量程上限。
 * @returns {object} 已归一化的渲染参数。
 */
export function createBuiltinMatrixRendererParams(
  rendererId,
  { matrix = {}, coordinateMap = null, valueMax = 200 } = {},
) {
  const rows = positiveInteger(matrix.rows || matrix.height);
  const cols = positiveInteger(matrix.cols || matrix.width);
  const normalizedMax = Math.max(1, Number(valueMax) || 1);
  const points = flattenCoordinateMap(coordinateMap);
  const pointParams = points?.length === rows * cols ? { points } : {};

  if (rendererId === 'numMatrix') {
    return normalizeNumMatrixParams({
      ...NUM_MATRIX_PRESETS.fast1024,
      backend: 'sprite3d',
      gridWidth: cols,
      gridHeight: rows,
      manageSidebar: false,
      textureValueMax: normalizedMax,
    });
  }

  if (rendererId === 'pointGrid') {
    return normalizePointGridParams({
      ...POINT_GRID_PRESETS.matCol,
      sit: { num1: rows, num2: cols, interp: 1, order: 0 },
      back: { num1: rows, num2: cols, interp: 1, order: 0 },
      ...pointParams,
    });
  }

  if (rendererId === 'webglHeatmap') {
    return normalizeWebglHeatmapParams({
      ...WEBGL_HEATMAP_PRESETS.plain,
      dataWidth: cols,
      dataHeight: rows,
      max: normalizedMax,
      minFrameLength: 1,
    });
  }

  if (rendererId === 'blobHeatmap') {
    return normalizeBlobHeatmapParams({
      ...BLOB_HEATMAP_PRESETS.default,
      dataWidth: cols,
      dataHeight: rows,
      max: normalizedMax,
    });
  }

  throw new Error(`不支持的矩阵渲染器: ${rendererId}`);
}
