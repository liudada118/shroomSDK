/**
 * params.test.js - 斑点热力的参数归一化
 *
 * 重点只有两条：
 *
 * 1. **`bed4096` 保留原件尺寸和阈值，但方向遵循 row-major 契约。**
 * 2. **归一化之后每个字段都有值。** 渲染器与 pipeline 里没有一处写 `?? 默认值`，
 *    全靠这里兜底。
 */

import { describe, expect, it } from 'vitest';

import {
  LEGACY_PRESETS,
  PARAM_RANGES,
  normalizeWebglHeatmapParams,
} from './params.js';

const REQUIRED_KEYS = [
  'dataWidth', 'dataHeight', 'canvasWidth', 'canvasHeight', 'radius',
  'max', 'filter', 'valueScale', 'blurFactor', 'edgeClear', 'mirrorX',
  'minFrameLength', 'chartWindow', 'displaySize', 'background',
];

describe('normalizeWebglHeatmapParams', () => {
  it.each([undefined, null, {}, 'nonsense', 42])('入参 %p 也给出完整的一份', (input) => {
    const params = normalizeWebglHeatmapParams(input);
    REQUIRED_KEYS.forEach((key) => {
      expect(params[key]).not.toBeUndefined();
    });
  });

  it('默认值保留通用参数，但默认关闭会改变输入顺序的镜像', () => {
    const params = normalizeWebglHeatmapParams();
    expect(params.dataWidth).toBe(64);
    expect(params.dataHeight).toBe(64);
    expect(params.canvasWidth).toBe(1024);
    expect(params.canvasHeight).toBe(1024);
    expect(params.radius).toBe(24);
    expect(params.max).toBe(200);
    expect(params.valueScale).toBe(1.8);
    expect(params.edgeClear).toEqual({ keepFrom: 6, keepTo: 58 });
    expect(params.mirrorX).toBe(false);
    expect(params.minFrameLength).toBe(4096);
  });

  it('超范围的值被夹回区间，不是丢掉', () => {
    const params = normalizeWebglHeatmapParams({ radius: 9999, dataWidth: 0 });
    expect(params.radius).toBe(PARAM_RANGES.radius.max);
    expect(params.dataWidth).toBe(PARAM_RANGES.dataWidth.min);
  });

  it('非数字回落到默认值，不产生 NaN', () => {
    const params = normalizeWebglHeatmapParams({ max: 'abc', radius: null });
    expect(params.max).toBe(200);
    expect(params.radius).toBe(24);
  });

  it('edgeClear 传 null / false 表示关掉', () => {
    expect(normalizeWebglHeatmapParams({ edgeClear: null }).edgeClear).toBeNull();
    expect(normalizeWebglHeatmapParams({ edgeClear: false }).edgeClear).toBeNull();
  });

  it('mirrorX 缺省关闭，只有显式传 true 才镜像', () => {
    expect(normalizeWebglHeatmapParams({}).mirrorX).toBe(false);
    expect(normalizeWebglHeatmapParams({ mirrorX: true }).mirrorX).toBe(true);
  });
});

describe('LEGACY_PRESETS', () => {
  it('bed4096 也保持 row-major 原顺序', () => {
    const params = normalizeWebglHeatmapParams(LEGACY_PRESETS.bed4096);
    expect(params).toMatchObject({
      dataWidth: 64,
      dataHeight: 64,
      canvasWidth: 1024,
      canvasHeight: 1024,
      radius: 24,
      max: 200,
      filter: 0,
      valueScale: 1.8,
      mirrorX: false,
      minFrameLength: 4096,
    });
    expect(params.edgeClear).toEqual({ keepFrom: 6, keepTo: 58 });
  });

  it('plain 不对应任何原实现 —— 喂什么画什么', () => {
    const params = normalizeWebglHeatmapParams(LEGACY_PRESETS.plain);
    expect(params.edgeClear).toBeNull();
    expect(params.mirrorX).toBe(false);
    expect(params.valueScale).toBe(1);
  });

  it('每条预设都能归一化', () => {
    Object.values(LEGACY_PRESETS).forEach((preset) => {
      expect(() => normalizeWebglHeatmapParams(preset)).not.toThrow();
    });
  });
});
