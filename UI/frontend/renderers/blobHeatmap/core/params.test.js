/**
 * renderers/blobHeatmap/core/params.test.js
 *
 * 归一化层的三条职责：字段齐、默认值等于原件那些写死值、垃圾输入不外泄。
 * 外加把「两条预设逐字等于原件那个 `matrixName == 'carCol'` 分支」钉死。
 */

import { describe, expect, it } from 'vitest';

import {
  LEGACY_PRESETS,
  PARAM_RANGES,
  normalizeBlobHeatmapParams,
} from './params.js';

const KEYS = [
  'dataWidth', 'dataHeight', 'radius', 'max', 'min',
  'maxOpacity', 'alphaFloor', 'canvasScale', 'shadow', 'gradient',
];

describe('normalizeBlobHeatmapParams', () => {
  it('默认值逐个等于原件里的写死值', () => {
    expect(normalizeBlobHeatmapParams()).toEqual({
      dataWidth: 32,      // canvas.jsx:26-27
      dataHeight: 32,
      radius: 50,         // options.size
      max: 600,           // options.max —— 全仓唯一的 600
      min: 0,
      maxOpacity: 0.9,    // colorize 默认
      alphaFloor: 0.7,    // colorize 里写死的下界
      canvasScale: 0.6,   // window.innerHeight * 0.6
      shadow: true,
      gradient: null,
    });
  });

  it('垃圾输入也补齐每一个字段', () => {
    [undefined, null, 0, '', 'nope', [], NaN].forEach((input) => {
      const params = normalizeBlobHeatmapParams(input);
      KEYS.forEach((key) => {
        expect(params, `${String(input)} 缺 ${key}`).toHaveProperty(key);
      });
    });
  });

  it('null / undefined / 空串都退回默认值，不被当成 0', () => {
    const params = normalizeBlobHeatmapParams({
      radius: null, max: undefined, dataWidth: '', canvasScale: null,
    });
    expect(params.radius).toBe(50);
    expect(params.max).toBe(600);
    expect(params.dataWidth).toBe(32);
    expect(params.canvasScale).toBe(0.6);
  });

  it('非数值退回默认值', () => {
    const params = normalizeBlobHeatmapParams({ radius: 'big', max: {}, min: NaN });
    expect(params.radius).toBe(50);
    expect(params.max).toBe(600);
    expect(params.min).toBe(0);
  });

  it('数字串当数字收', () => {
    expect(normalizeBlobHeatmapParams({ radius: '80' }).radius).toBe(80);
  });

  it('越界值夹到区间两端', () => {
    const low = normalizeBlobHeatmapParams({
      radius: -5, dataWidth: 0, maxOpacity: -1, canvasScale: 0,
    });
    expect(low.radius).toBe(PARAM_RANGES.radius.min);
    expect(low.dataWidth).toBe(PARAM_RANGES.dataWidth.min);
    expect(low.maxOpacity).toBe(PARAM_RANGES.maxOpacity.min);
    expect(low.canvasScale).toBe(PARAM_RANGES.canvasScale.min);

    const high = normalizeBlobHeatmapParams({
      radius: 1e9, dataHeight: 1e9, maxOpacity: 9, alphaFloor: 9,
    });
    expect(high.radius).toBe(PARAM_RANGES.radius.max);
    expect(high.dataHeight).toBe(PARAM_RANGES.dataHeight.max);
    expect(high.maxOpacity).toBe(PARAM_RANGES.maxOpacity.max);
    expect(high.alphaFloor).toBe(PARAM_RANGES.alphaFloor.max);
  });

  it('alphaFloor 允许 0（那是"把糊掉的淡色区放开"的开关）', () => {
    expect(normalizeBlobHeatmapParams({ alphaFloor: 0 }).alphaFloor).toBe(0);
  });

  it('shadow 缺省为 true，给了就按真假收', () => {
    expect(normalizeBlobHeatmapParams({}).shadow).toBe(true);
    expect(normalizeBlobHeatmapParams({ shadow: false }).shadow).toBe(false);
    expect(normalizeBlobHeatmapParams({ shadow: 0 }).shadow).toBe(false);
    expect(normalizeBlobHeatmapParams({ shadow: 'yes' }).shadow).toBe(true);
  });

  it('gradient 透传，缺省是 null（用 GRADIENT_STOPS）', () => {
    const stops = { 0: 'red', 1: 'blue' };
    expect(normalizeBlobHeatmapParams({ gradient: stops }).gradient).toBe(stops);
    expect(normalizeBlobHeatmapParams({}).gradient).toBeNull();
  });

  it('每个区间的 min 都不大于 max', () => {
    Object.entries(PARAM_RANGES).forEach(([key, range]) => {
      expect(range.min, key).toBeLessThanOrEqual(range.max);
    });
  });

  it('不回抛入参对象，改归一化结果不会污染调用方', () => {
    const input = { radius: 60 };
    const params = normalizeBlobHeatmapParams(input);
    expect(params).not.toBe(input);
    params.radius = 999;
    expect(input.radius).toBe(60);
  });
});

describe('LEGACY_PRESETS', () => {
  it('default 逐字等于原件的非 carCol 那一支', () => {
    expect(LEGACY_PRESETS.default)
      .toEqual({ dataWidth: 32, dataHeight: 32, radius: 50, max: 600 });
  });

  it('carCol 逐字等于原件那个 if 分支里的四个数', () => {
    // canvas.jsx:28-33 —— width=10, height=9, options.max=300, options.size=100
    expect(LEGACY_PRESETS.carCol)
      .toEqual({ dataWidth: 10, dataHeight: 9, radius: 100, max: 300 });
  });

  it('两条预设都能过归一化且不被夹', () => {
    Object.entries(LEGACY_PRESETS).forEach(([name, preset]) => {
      const params = normalizeBlobHeatmapParams(preset);
      Object.entries(preset).forEach(([key, value]) => {
        expect(params[key], `${name}.${key}`).toBe(value);
      });
    });
  });

  it('挂过 carCol 不会串味到下一个实例 —— 原件那个模块级 bug 修掉了', () => {
    const car = normalizeBlobHeatmapParams(LEGACY_PRESETS.carCol);
    expect(car.max).toBe(300);
    // 原件在这一步之后，模块级 options.max 已经被改成 300 了。
    const next = normalizeBlobHeatmapParams(LEGACY_PRESETS.default);
    expect(next.max).toBe(600);
    expect(next.radius).toBe(50);
  });
});
