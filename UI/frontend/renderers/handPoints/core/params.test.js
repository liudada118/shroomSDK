/**
 * params.test.js - handPoints 参数归一化与三条预设
 *
 * 这一份钉两件事：
 *
 * 1. **归一化对任何垃圾输入都不抛。** 参数来自 manifest（JSON，可能是人手写的），
 *    渲染器在 `useMemo` 里同步调它 —— 抛了就是整块白屏 + 一个 React 错误边界，
 *    而不是"这个参数没生效"。包内另两个渲染器的 `normalize*Params` 是同一个约定。
 * 2. **三条预设过一遍归一化之后原样不变。** 预设是从原组件常量区抄来的，如果某个
 *    值恰好落在 `PARAM_RANGES` 之外，归一化会静默把它夹掉 —— 那就是"搬进包画面就
 *    变了"，而且极难查。这条把它变成会红的断言。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FINGER_BONES,
  LEGACY_PRESETS,
  MASK_SOURCES,
  PARAM_RANGES,
  deriveGridSize,
  normalizeHandPointsParams,
} from './params.js';
import { INTERP_MODES } from './pipeline.js';
import { MASK_MODES, POINT_TABLES } from './layout.js';

describe('三条预设', () => {
  it('就是那三条', () => {
    expect(Object.keys(LEGACY_PRESETS)).toEqual(['hand0205', 'hand0205Alt', 'hand0205_147']);
  });

  it.each(Object.keys(LEGACY_PRESETS))('%s 过归一化之后原样不变（没有被夹掉的值）', (id) => {
    const preset = LEGACY_PRESETS[id];
    const normalized = normalizeHandPointsParams(preset);
    Object.entries(preset).forEach(([key, value]) => {
      expect(normalized[key], `${id}.${key} 被归一化改动了`).toEqual(value);
    });
  });

  it('归一化是幂等的', () => {
    Object.values(LEGACY_PRESETS).forEach((preset) => {
      const once = normalizeHandPointsParams(preset);
      expect(normalizeHandPointsParams(once)).toEqual(once);
    });
  });

  it('每条预设的枚举值都在合法集合里', () => {
    Object.entries(LEGACY_PRESETS).forEach(([id, preset]) => {
      expect(Object.keys(POINT_TABLES), `${id}.pointTable`).toContain(preset.pointTable);
      expect(MASK_MODES, `${id}.maskMode`).toContain(preset.maskMode);
      expect(INTERP_MODES, `${id}.interpMode`).toContain(preset.interpMode);
      expect(MASK_SOURCES, `${id}.maskSource`).toContain(preset.maskSource);
    });
  });

  /**
   * 这是本批相对计划文本要明说的那处偏差的钉子：两个原组件在 `maskSource` 上
   * **行为不同**（`hand0205` 按掩码判、147 按压力判），搬进包时保留成了开关而不是
   * 统一。谁哪天"顺手统一"，这条会红。
   */
  it('hand0205 与 147 的 maskSource 确实不同 —— 这是真行为差异，不是笔误', () => {
    expect(LEGACY_PRESETS.hand0205.maskSource).toBe('mask');
    expect(LEGACY_PRESETS.hand0205_147.maskSource).toBe('value');
  });

  it('hand0205Alt 与 hand0205 只差 pointTable 一项', () => {
    const diff = Object.keys(LEGACY_PRESETS.hand0205)
      .filter((key) => JSON.stringify(LEGACY_PRESETS.hand0205[key])
        !== JSON.stringify(LEGACY_PRESETS.hand0205Alt[key]));
    expect(diff).toEqual(['pointTable']);
  });

  it('hand0205 与 147 的净差异恰好是那九项', () => {
    // 与 params.js 头部那张表逐项对账。表和代码漂了，这条会红。
    const diff = Object.keys(LEGACY_PRESETS.hand0205)
      .filter((key) => JSON.stringify(LEGACY_PRESETS.hand0205[key])
        !== JSON.stringify(LEGACY_PRESETS.hand0205_147[key]));
    expect(diff.sort()).toEqual([
      'hiddenY',
      'interpMode',
      'maskBlur',
      'maskMode',
      'maskSource',
      'particleScale',
      'pointSize',
      'pointTable',
      'rotationX',
      'sit', // interp 2→4 与 order 4→6 都在这个子对象里
    ].sort());
  });
});

describe('归一化：非法输入退回默认值而不抛', () => {
  it.each([
    ['undefined', undefined],
    ['空对象', {}],
    ['null 值', { sit: null, pointSize: null, particleScale: null }],
    ['字符串', { sit: { num1: 'abc' }, pointSize: 'x', rotationX: 'y' }],
    ['NaN / Infinity', { pointSize: NaN, maskBlur: Infinity, separation: -Infinity }],
    ['空串', { pointSize: '', rotationX: '', modelUrl: '' }],
    ['数组当对象', { sit: [1, 2, 3] }],
    ['布尔', { pointTable: true, maskMode: false, interpMode: true }],
  ])('%s 不抛，且给出完整参数', (_label, input) => {
    const out = normalizeHandPointsParams(input);
    expect(out.sit).toEqual({ num1: 32, num2: 32, interp: 2, order: 4 });
    expect(Number.isFinite(out.pointSize)).toBe(true);
    expect(Number.isFinite(out.rotationX)).toBe(true);
    expect(out.particleScale).toHaveLength(3);
    expect(Object.keys(POINT_TABLES)).toContain(out.pointTable);
  });

  it('数值被夹到 PARAM_RANGES 里', () => {
    const out = normalizeHandPointsParams({
      sit: { num1: 9999, num2: -5, interp: 99, order: -1 },
      fps: 0,
      separation: 1e9,
      maskBlur: 999,
      hiddenY: 5, // 上界是 0：正数会把点抬到画面上方，夹回 0
    });
    expect(out.sit.num1).toBe(PARAM_RANGES.num1.max);
    expect(out.sit.num2).toBe(PARAM_RANGES.num2.min);
    expect(out.sit.interp).toBe(PARAM_RANGES.interp.max);
    expect(out.sit.order).toBe(PARAM_RANGES.order.min);
    expect(out.fps).toBe(PARAM_RANGES.fps.min);
    expect(out.separation).toBe(PARAM_RANGES.separation.max);
    expect(out.maskBlur).toBe(PARAM_RANGES.maskBlur.max);
    expect(out.hiddenY).toBe(PARAM_RANGES.hiddenY.max);
  });

  it('整数参数会取整，浮点参数不会', () => {
    const out = normalizeHandPointsParams({ sit: { interp: 2.7 }, pointSize: 0.3333 });
    expect(out.sit.interp).toBe(3);
    expect(out.pointSize).toBeCloseTo(0.3333, 10);
  });

  it('particleScale 传单个数字会铺成三份', () => {
    expect(normalizeHandPointsParams({ particleScale: 0.002 }).particleScale)
      .toEqual([0.002, 0.002, 0.002]);
  });

  it('particleScale 长度不足或含非数会整条退回默认值', () => {
    const fallback = [0.0011, 0.0011, 0.0011];
    expect(normalizeHandPointsParams({ particleScale: [1, 2] }).particleScale).toEqual(fallback);
    expect(normalizeHandPointsParams({ particleScale: [1, 'x', 3] }).particleScale)
      .toEqual(fallback);
    // 多于 3 项则只取前三。
    expect(normalizeHandPointsParams({ particleScale: [1, 2, 3, 4] }).particleScale)
      .toEqual([1, 2, 3]);
  });

  it('rotationX / rotationZ 允许 0 —— 不能被当成"没传"', () => {
    // `Number.isFinite(0)` 为真但 `if (!value)` 为假：这两项用的是显式判空，
    // 传 0 必须真的是 0（手模不转），而不是退回 Math.PI。
    const out = normalizeHandPointsParams({ rotationX: 0, rotationZ: 0 });
    expect(out.rotationX).toBe(0);
    expect(out.rotationZ).toBe(0);
  });

  it('modelUrl 传空串就是"不加载模型"，不退回默认路径', () => {
    // 见 params.js：空串是一个有意义的取值（只剩点云，关节命令变空操作）。
    expect(normalizeHandPointsParams({ modelUrl: '' }).modelUrl).toBe('');
    expect(normalizeHandPointsParams({}).modelUrl).toBe('');
    expect(normalizeHandPointsParams({ modelUrl: 123 }).modelUrl).toBe('');
  });

  it('pointSprite 空串 / 非字符串一律为 null（走包内自带的 circle.png）', () => {
    expect(normalizeHandPointsParams({}).pointSprite).toBeNull();
    expect(normalizeHandPointsParams({ pointSprite: '' }).pointSprite).toBeNull();
    expect(normalizeHandPointsParams({ pointSprite: 42 }).pointSprite).toBeNull();
    expect(normalizeHandPointsParams({ pointSprite: '/a.png' }).pointSprite).toBe('/a.png');
  });

  it('fingerBones 空数组退回默认，非空数组原样透传', () => {
    expect(normalizeHandPointsParams({ fingerBones: [] }).fingerBones)
      .toBe(DEFAULT_FINGER_BONES);
    expect(normalizeHandPointsParams({}).fingerBones).toBe(DEFAULT_FINGER_BONES);
    const custom = [['A', 'B']];
    expect(normalizeHandPointsParams({ fingerBones: custom }).fingerBones).toBe(custom);
  });

  it('默认骨骼名：拇指两节、其余四指三节', () => {
    // 原实现如此（`Finger_01`/`Finger_02` 没有 `Finger_00`），取不到的骨骼在
    // 旋转时被静默跳过。
    expect(DEFAULT_FINGER_BONES.map((f) => f.length)).toEqual([2, 3, 3, 3, 3]);
    expect(DEFAULT_FINGER_BONES[0]).toEqual(['Finger_01', 'Finger_02']);
  });
});

describe('deriveGridSize', () => {
  it('公式是 num * interp + order * 2', () => {
    expect(deriveGridSize({ num1: 32, num2: 32, interp: 2, order: 4 }))
      .toEqual({ amountX: 72, amountY: 72, total: 72 * 72 });
  });

  it('两条预设的顶点数：hand0205 是 72²，147 是 140²', () => {
    // params.js 头部写着这两个数，这条是对账。147 那条快 20000 个顶点 ——
    // 它是本包顶点数最多的渲染器，`PARAM_RANGES` 的上界就是为了防止误填把它撑爆。
    const a = deriveGridSize(normalizeHandPointsParams(LEGACY_PRESETS.hand0205).sit);
    expect(a).toEqual({ amountX: 72, amountY: 72, total: 5184 });
    const b = deriveGridSize(normalizeHandPointsParams(LEGACY_PRESETS.hand0205_147).sit);
    expect(b).toEqual({ amountX: 140, amountY: 140, total: 19600 });
  });

  it('order 为 0 时就是纯 num * interp', () => {
    expect(deriveGridSize({ num1: 10, num2: 8, interp: 3, order: 0 }))
      .toEqual({ amountX: 30, amountY: 24, total: 720 });
  });
});

describe('PARAM_RANGES 自身的自洽', () => {
  it('每一项都是 min <= max', () => {
    Object.entries(PARAM_RANGES).forEach(([key, { min, max }]) => {
      expect(Number.isFinite(min), `${key}.min`).toBe(true);
      expect(Number.isFinite(max), `${key}.max`).toBe(true);
      expect(min, `${key}: min 大于 max`).toBeLessThanOrEqual(max);
    });
  });

  it('MASK_SOURCES 是那两条', () => {
    expect(MASK_SOURCES).toEqual(['mask', 'value']);
  });
});
