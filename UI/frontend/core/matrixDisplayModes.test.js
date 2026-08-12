import { describe, expect, it } from 'vitest';

import {
  BUILTIN_MATRIX_RENDERER_OPTIONS,
  MATRIX_DISPLAY_MODES,
  createBuiltinMatrixRendererParams,
  createDirectionCheckFrame,
  createMatrixDisplayRenderers,
  inferMatrixDisplayModeId,
} from './matrixDisplayModes.js';

describe('matrixDisplayModes', () => {
  it('提供五种面向用户的矩阵展示形式', () => {
    expect(MATRIX_DISPLAY_MODES.map((mode) => mode.rendererId)).toEqual([
      'heatmap',
      'matrix',
      'pointGrid',
      'numMatrix',
      'blobHeatmap',
    ]);
  });

  it('根据矩阵尺寸和坐标生成 3D 渲染参数', () => {
    const coordinateMap = {
      coordinates: [
        [[0, 0], [2, 0], [4, 0]],
        [[0, 3], [2, 3], [4, 3]],
      ],
    };
    const renderers = createMatrixDisplayRenderers({
      matrix: { rows: 2, cols: 3 },
      coordinateMap,
    });

    expect(renderers.find((item) => item.id === 'pointGrid').params).toMatchObject({
      sit: { num1: 2, num2: 3, interp: 1, order: 0 },
      points: [[0, 0], [2, 0], [4, 0], [0, 3], [2, 3], [4, 3]],
    });
    expect(renderers.find((item) => item.id === 'numMatrix').params).toMatchObject({
      backend: 'sprite3d',
      gridWidth: 3,
      gridHeight: 2,
    });
  });

  it('生成方向校验帧并兼容旧 renderer id', () => {
    expect(createDirectionCheckFrame(5)).toEqual([1, 2, 3, 4, 5]);
    expect(inferMatrixDisplayModeId('pointGrid')).toBe('matrix-points-3d');
    expect(inferMatrixDisplayModeId('unknown')).toBe('shape-heatmap-2d');
  });

  it('为所有通用矩阵渲染器生成同一份 2×3 输入参数', () => {
    const coordinateMap = [
      [[0, 1], [1, 1], [2, 1]],
      [[0, 0], [1, 0], [2, 0]],
    ];
    const context = {
      matrix: { rows: 2, cols: 3 },
      coordinateMap,
      valueMax: 6,
    };

    expect(BUILTIN_MATRIX_RENDERER_OPTIONS.map((item) => item.id)).toEqual([
      'numMatrix',
      'pointGrid',
      'webglHeatmap',
      'blobHeatmap',
    ]);
    expect(createBuiltinMatrixRendererParams('numMatrix', context)).toMatchObject({
      gridWidth: 3,
      gridHeight: 2,
      textureValueMax: 6,
    });
    expect(createBuiltinMatrixRendererParams('pointGrid', context)).toMatchObject({
      sit: { num1: 2, num2: 3, interp: 1, order: 0 },
      points: [[0, 1], [1, 1], [2, 1], [0, 0], [1, 0], [2, 0]],
    });
    expect(createBuiltinMatrixRendererParams('webglHeatmap', context)).toMatchObject({
      dataWidth: 3,
      dataHeight: 2,
      max: 6,
      minFrameLength: 1,
    });
    expect(createBuiltinMatrixRendererParams('blobHeatmap', context)).toMatchObject({
      dataWidth: 3,
      dataHeight: 2,
      max: 6,
    });
    expect(() => createBuiltinMatrixRendererParams('unknown', context)).toThrow('不支持');
  });
});
