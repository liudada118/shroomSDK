/**
 * pipeline.test.js - 参数化管线与三份 NumThreeColor 的逐点一致性验证
 *
 * 验证方式是差分测试：把三份原实现的对应片段按原样内联为参照实现
 * （常量与表达式直接抄自那三个文件），再与参数化管线跑同一批输入逐点比对。
 *
 * 参照实现刻意写成「抄」的样子而不是复用 pipeline.js，否则两边共享同一份
 * 代码，测试就退化成自我验证、证明不了任何东西。
 *
 * 本文件最重要的一组是「布局等价性」：合并这三个文件的全部前提是
 * 它们的位置公式与格子尺寸公式代数等价。那一组不通过，合并就是错的。
 */

import { describe, expect, it } from 'vitest';

import { findMax } from '../../../core/frameMath.js';
import {
  BACKENDS,
  LEGACY_PRESETS,
  deriveGrid,
  normalizeNumMatrixParams,
} from './params.js';
import {
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
  getTextureRange,
  instanceWorldPosition,
  quantizeFrame,
  resolveCanvasSize,
} from './pipeline.js';

// 浮点代数等价的比对精度。三份公式化简后同解，但乘除次序不同，
// 末位可能差一个 ulp（~1e-17）。世界坐标范围是 [-1, 1]，1e-12 已远低于
// 任何像素能分辨的量级。
const FLOAT_PRECISION = 12;

/**
 * `three/NumThreeColor copy.jsx:445` 的位置公式，逐字抄。
 *
 * 原文：`dummy.position.set((x - (32 / size - 0.5)) / 32 * size, (y - (32 / size - 0.5)) / 32 * size, 0)`
 * 该文件的 `gridSize = 64 / size`，`size` 默认 4。
 */
function referenceFast256Position(index, size) {
  const gridSize = 64 / size;
  const x = index % gridSize;
  const y = Math.floor(index / gridSize);
  return {
    x: ((x - (32 / size - 0.5)) / 32) * size,
    y: ((y - (32 / size - 0.5)) / 32) * size,
  };
}

/**
 * `three/NumThreeColor1024sit.jsx:375` 的位置公式，逐字抄。
 *
 * 原文：`dummy.position.set((x - (gridSize / 2 - 0.5)) / (gridSize / 2), (y - (gridSize / 2 - 0.5)) / (gridSize / 2), 0)`
 * 该文件的 `gridSize` 写死 23。
 */
function referenceFast1024sitPosition(index, gridSize) {
  const x = index % gridSize;
  const y = Math.floor(index / gridSize);
  return {
    x: (x - (gridSize / 2 - 0.5)) / (gridSize / 2),
    y: (y - (gridSize / 2 - 0.5)) / (gridSize / 2),
  };
}

/**
 * 三份共有的 `sitData()` 统计段，逐字抄。
 *
 * 抄自 `NumThreeColor copy.jsx:97-111`（另外两份同一段一字不差）。
 */
function referenceStats(dataArr) {
  const max = findMax(dataArr);
  const point = dataArr.filter((a) => a > 0).length;
  const press = dataArr.reduce((a, b) => a + b, 0);
  const mean = press / (point === 0 ? 1 : point);
  return { max, point, press, mean };
}

/**
 * `NumThreeColor copy.jsx:431` / `1024sit.jsx:361` 的量化写法，逐字抄。
 *
 * 原文：`res.map((a, index) => (a - valuef1 < 0 ? 0 : parseInt(a)))`
 */
function referenceShortQuantize(source, valuef1) {
  return source.map((a) => (a - valuef1 < 0 ? 0 : parseInt(a)));
}

/**
 * `NumThreeColor1024.jsx:520-524` 的量化写法，逐字抄。
 */
function referenceLongQuantize(source, valuef1, decimalScale) {
  return source.map((a) => {
    const numberValue = Number(a);
    if (!Number.isFinite(numberValue) || numberValue - valuef1 < 0) return 0;
    return decimalScale > 1 ? Number(numberValue.toFixed(1)) : parseInt(numberValue);
  });
}

describe('布局等价性 —— 合并三份 NumThreeColor 的前提', () => {
  it('Fast256（size=4，16×16）的位置公式与通用公式逐点相同', () => {
    const size = 4;
    const { gridWidth, gridHeight, count } = deriveGrid(
      normalizeNumMatrixParams(LEGACY_PRESETS.fast256),
    );
    expect({ gridWidth, gridHeight, count }).toEqual({ gridWidth: 16, gridHeight: 16, count: 256 });

    const worldCellSize = deriveWorldCellSize(gridWidth, gridHeight);
    for (let index = 0; index < count; index += 1) {
      const reference = referenceFast256Position(index, size);
      const actual = instanceWorldPosition(index, gridWidth, gridHeight, worldCellSize);
      expect(actual.x).toBeCloseTo(reference.x, FLOAT_PRECISION);
      expect(actual.y).toBeCloseTo(reference.y, FLOAT_PRECISION);
    }
  });

  it('Fast1024sit（23×23）的位置公式与通用公式逐点相同', () => {
    const { gridWidth, gridHeight, count } = deriveGrid(
      normalizeNumMatrixParams(LEGACY_PRESETS.fast1024sit),
    );
    expect({ gridWidth, gridHeight, count }).toEqual({ gridWidth: 23, gridHeight: 23, count: 529 });

    const worldCellSize = deriveWorldCellSize(gridWidth, gridHeight);
    for (let index = 0; index < count; index += 1) {
      const reference = referenceFast1024sitPosition(index, 23);
      const actual = instanceWorldPosition(index, gridWidth, gridHeight, worldCellSize);
      expect(actual.x).toBeCloseTo(reference.x, FLOAT_PRECISION);
      expect(actual.y).toBeCloseTo(reference.y, FLOAT_PRECISION);
    }
  });

  it('三份的格子边长公式同解', () => {
    // Fast256：`new THREE.PlaneGeometry(0.032 * size, 0.032 * size)`，size = 4
    const fast256 = deriveCellPlaneSize(deriveWorldCellSize(16, 16));
    expect(fast256).toBeCloseTo(0.032 * 4, FLOAT_PRECISION);

    // Fast1024sit：`new THREE.PlaneGeometry(2.048 / gridSize, 2.048 / gridSize)`，gridSize = 23
    const fast1024sit = deriveCellPlaneSize(deriveWorldCellSize(23, 23));
    expect(fast1024sit).toBeCloseTo(2.048 / 23, FLOAT_PRECISION);

    // Fast1024（size=2，32×32）：`worldCellSize * 1.024`，即通用式本身。
    // worldCellSize = 2/32 = 0.0625，格子边长 0.064 —— 比格距略大，相邻格微交叠盖缝。
    expect(deriveWorldCellSize(32, 32)).toBeCloseTo(0.0625, FLOAT_PRECISION);
    expect(deriveCellPlaneSize(deriveWorldCellSize(32, 32))).toBeCloseTo(0.064, FLOAT_PRECISION);
    // 交叠比例三份一致：边长恒为格距的 1.024 倍。
    for (const [gw, gh] of [[16, 16], [23, 23], [32, 32], [64, 16]]) {
      const cell = deriveWorldCellSize(gw, gh);
      expect(deriveCellPlaneSize(cell) / cell).toBeCloseTo(1.024, FLOAT_PRECISION);
    }
  });

  it('非正方矩阵按长边定格距，短边居中而不拉伸', () => {
    // 长边贴满 [-1, 1]，短边留白 —— 与 NumThreeColor1024 的 max(gw, gh) 一致。
    const worldCellSize = deriveWorldCellSize(64, 16);
    expect(worldCellSize).toBeCloseTo(2 / 64, FLOAT_PRECISION);

    const first = instanceWorldPosition(0, 64, 16, worldCellSize);
    const last = instanceWorldPosition(64 * 16 - 1, 64, 16, worldCellSize);
    // 水平方向左右对称贴边
    expect(first.x).toBeCloseTo(-last.x, FLOAT_PRECISION);
    expect(last.x).toBeCloseTo((63 / 2) * (2 / 64), FLOAT_PRECISION);
    // 垂直方向同样对称，但只占 16/64 的高度
    expect(first.y).toBeCloseTo(-last.y, FLOAT_PRECISION);
    expect(last.y).toBeCloseTo((15 / 2) * (2 / 64), FLOAT_PRECISION);
  });
});

describe('帧统计与三份原实现逐点相同', () => {
  const samples = [
    new Array(256).fill(0),
    new Array(256).fill(0).map((_, index) => index % 7),
    [0, 0, 0, 12, 0, 255, 3, 0],
    [1.5, 2.25, 0, 0.75],
  ];

  it.each(samples.map((frame, index) => [index, frame]))(
    '样本 %i 的 max / point / total / mean 与参照实现相同',
    (_index, frame) => {
      const reference = referenceStats(frame);
      const actual = computeFrameStats(frame);
      expect(actual.max).toBe(reference.max);
      expect(actual.point).toBe(reference.point);
      expect(actual.total).toBe(reference.press);
      expect(actual.mean).toBe(reference.mean);
    },
  );

  it('全零帧的均值不除零', () => {
    // 原实现的 `point == 0 ? 1 : point`。少了这一步会得到 NaN，
    // 侧栏「平均压力」会显示成 NaN 而不是 0.00。
    expect(computeFrameStats(new Array(16).fill(0)).mean).toBe(0);
  });

  it('下限过滤不取整 —— 统计走浮点，画面走整数', () => {
    // 这个不对称是原实现的行为：sitData 那遍 map 没有 parseInt。
    expect(applyFloorFilter([1.5, 2.75, 0.5], 1)).toEqual([1.5, 2.75, 0]);
  });
});

describe('量化与两种原写法逐点相同', () => {
  const frames = [
    [0, 1, 2, 3, 255],
    [1.4, 1.5, 1.6, 2.5, 99.99],
    [-3, 0, 3],
    ['5', '7.8'],
  ];

  it.each(frames.map((frame, index) => [index, frame]))(
    '样本 %i 与短写法（copy / 1024sit）相同',
    (_index, frame) => {
      expect(quantizeFrame(frame, 2, 1)).toEqual(referenceShortQuantize(frame, 2));
    },
  );

  it.each(frames.map((frame, index) => [index, frame]))(
    '样本 %i 与长写法（1024）相同',
    (_index, frame) => {
      expect(quantizeFrame(frame, 2, 1)).toEqual(referenceLongQuantize(frame, 2, 1));
    },
  );

  it('NaN 是两种原写法的唯一分歧，取长写法的 0', () => {
    // 短写法给 parseInt(NaN) === NaN，算出 NaN 的 uvOffset 会把那一格
    // 渲染成任意数字；长写法给 0。合法数据下两者无差别。
    expect(referenceShortQuantize([NaN], 0)[0]).toBeNaN();
    expect(quantizeFrame([NaN], 0, 1)).toEqual([0]);
  });

  it('定点倍率 10 时保留一位小数而不取整', () => {
    expect(quantizeFrame([12.34, 5.67], 0, 10)).toEqual([12.3, 5.7]);
    expect(quantizeFrame([12.34, 5.67], 0, 10)).toEqual(referenceLongQuantize([12.34, 5.67], 0, 10));
  });
});

describe('精灵图格数与取值', () => {
  it('8 位数据走 16×16 的 256 格', () => {
    expect(getTextureRange(0)).toEqual({ max: 255, cols: 16, rows: 16 });
    expect(getTextureRange(255)).toEqual({ max: 255, cols: 16, rows: 16 });
    expect(getTextureCanvasSize(getTextureRange(0))).toEqual({ width: 512, height: 512 });
  });

  it('12 位数据改成 32 列，行数够装下最大值', () => {
    const range = getTextureRange(2550);
    expect(range.cols).toBe(32);
    expect(range.max).toBe(2550);
    // 必须装得下 0..2550 共 2551 格，否则超出的数值会取到纹理外。
    expect(range.cols * range.rows).toBeGreaterThanOrEqual(2551);
    expect(range.rows).toBe(Math.ceil(2551 / 32));
  });

  it('夹值不会越出纹理', () => {
    expect(clampTextureValue(-5, 0)).toBe(0);
    expect(clampTextureValue(999, 0)).toBe(255);
    expect(clampTextureValue(999, 2550)).toBe(999);
    expect(clampTextureValue(9999, 2550)).toBe(2550);
    // 坏数据不该变成 NaN 的 uv
    expect(clampTextureValue(undefined, 0)).toBe(0);
    expect(clampTextureValue(NaN, 0)).toBe(0);
  });

  it('uv 偏移与原实现的 (d%16)/16, floor(d/16)/16 相同', () => {
    const range = getTextureRange(0);
    for (const value of [0, 1, 15, 16, 17, 200, 255]) {
      expect(cellUvOffset(value, range)).toEqual([(value % 16) / 16, Math.floor(value / 16) / 16]);
    }
  });

  it('classic 染色与原实现的 (r, 0.2, 1-r) 相同', () => {
    for (const value of [0, 64, 128, 255]) {
      const [r, g, b] = classicTint(value, 255);
      expect(r).toBeCloseTo(value / 255, FLOAT_PRECISION);
      expect(g).toBe(0.2);
      expect(b).toBeCloseTo(1 - value / 255, FLOAT_PRECISION);
    }
  });

  it('格子上印的文本按定点倍率格式化', () => {
    expect(formatDisplayValue(123, 1)).toBe('123');
    expect(formatDisplayValue(123, 10)).toBe('12.3');
  });
});

describe('滚动窗口与画布尺寸', () => {
  it('窗口满 20 之后先出后进，长度恒定', () => {
    const window = createRollingWindow(20);
    for (let index = 0; index < 25; index += 1) window.push(index);
    const values = window.values();
    expect(values.length).toBe(20);
    expect(values[0]).toBe(5);
    expect(values[19]).toBe(24);
  });

  it('两个实例互不干扰', () => {
    // 原实现把这两个数组放在组件函数作用域，本来就是每实例。
    const left = createRollingWindow(3);
    const right = createRollingWindow(3);
    left.push(1);
    expect(right.values()).toEqual([]);
  });

  it('小屏与大屏各用自己的比例', () => {
    const wide = LEGACY_PRESETS.fast256.canvasHeightRatio;
    expect(resolveCanvasSize(700, wide)).toBeCloseTo(700 * 0.6, FLOAT_PRECISION);
    expect(resolveCanvasSize(1000, wide)).toBeCloseTo(1000 * 0.8, FLOAT_PRECISION);

    // 1024sit 的画布刻意更小，抄自该文件的 0.5 / 0.65。
    const narrow = normalizeNumMatrixParams(LEGACY_PRESETS.fast1024sit).canvasHeightRatio;
    expect(resolveCanvasSize(700, narrow)).toBeCloseTo(700 * 0.5, FLOAT_PRECISION);
    expect(resolveCanvasSize(1000, narrow)).toBeCloseTo(1000 * 0.65, FLOAT_PRECISION);
    // 750 是原实现的分界，等于 750 走大屏那支。
    expect(resolveCanvasSize(750, narrow)).toBeCloseTo(750 * 0.65, FLOAT_PRECISION);
  });
});

describe('参数归一化', () => {
  it('三条预设复现三个文件的常量', () => {
    const fast256 = normalizeNumMatrixParams(LEGACY_PRESETS.fast256);
    expect(fast256.size).toBe(4);
    expect(fast256.cameraControls).toBe(true);
    expect(fast256.retintOnThresholdChange).toBe(true);
    expect(fast256.pressureRedistribution.enabled).toBe(false);
    // Fast256 与 Bed4096 共用调参对象，切模式不重置 —— 这是它必须留的理由。
    expect(fast256.sharedTuningKey).toBe('bed4096');

    const fast1024sit = normalizeNumMatrixParams(LEGACY_PRESETS.fast1024sit);
    expect(fast1024sit.pressureRedistribution).toEqual({
      enabled: true, rows: 23, cols: 23, axis: 'col',
    });
    // 该文件的纹理写死 jet(0, 30)，拖颜色滑块画面不动。照抄。
    expect(fast1024sit.retintOnThresholdChange).toBe(false);
    expect(fast1024sit.cameraControls).toBe(false);

    const smallBed = normalizeNumMatrixParams(LEGACY_PRESETS.smallBed12B);
    expect(smallBed.decimalScale).toBe(10);
    // 0 = 自动。原实现无人传 `textureValueMax` 这个 prop，量程一直走
    // `valuej1 * decimalScale` 动态推导（默认 200×10 = 2000）并随阈值重烘。
    // 预设里写死常量会改掉 classicTint 的分母，是可见的配色变化。
    expect(smallBed.textureValueMax).toBe(0);
    expect(smallBed.chartPadding).toBe(5);
    expect(smallBed.totalMetric).toBe('max');
  });

  it('缺省与坏值一律回落默认，不抛错', () => {
    const empty = normalizeNumMatrixParams();
    expect(empty.size).toBe(2);
    expect(empty.gridWidth).toBe(0);
    expect(empty.decimalScale).toBe(1);
    expect(empty.chartWindow).toBe(20);
    expect(empty.chartPadding).toBe(1000);
    expect(empty.totalMetric).toBe('sum');
    expect(empty.manageSidebar).toBe(true);
    expect(empty.sharedTuningKey).toBe(null);

    // 空串不该被当成 0 夹到下界
    expect(normalizeNumMatrixParams({ size: '' }).size).toBe(2);
    expect(normalizeNumMatrixParams({ size: 'abc' }).size).toBe(2);
    expect(normalizeNumMatrixParams({ size: -3 }).size).toBe(1);
    expect(normalizeNumMatrixParams({ size: 9999 }).size).toBe(64);
  });

  it('gridWidth 为 0 时由 size 推导，非 0 时显式优先', () => {
    expect(deriveGrid(normalizeNumMatrixParams({ size: 2 }))).toEqual({
      gridWidth: 32, gridHeight: 32, count: 1024,
    });
    expect(deriveGrid(normalizeNumMatrixParams({ size: 2, gridWidth: 64, gridHeight: 8 }))).toEqual({
      gridWidth: 64, gridHeight: 8, count: 512,
    });
  });

  it('manageSidebar 只认显式 false', () => {
    expect(normalizeNumMatrixParams({ manageSidebar: false }).manageSidebar).toBe(false);
    expect(normalizeNumMatrixParams({ manageSidebar: 'false' }).manageSidebar).toBe(false);
    expect(normalizeNumMatrixParams({ manageSidebar: undefined }).manageSidebar).toBe(true);
  });
});

describe('canvas2d 后端参数', () => {
  it('两条 num3D 预设复现 NumWs.jsx 的常量', () => {
    const def = normalizeNumMatrixParams(LEGACY_PRESETS.num3dDefault);
    expect(def.backend).toBe('canvas2d');
    expect(deriveGrid(def)).toEqual({ gridWidth: 32, gridHeight: 32, count: 1024 });
    // layoutData（NumWs.jsx:341-374）：窗口 60、两条曲线留白都是 20、
    // 总压曲线减 1 再画、受压点数取的是**过滤前**的原始帧。
    expect(def.chartWindow).toBe(60);
    expect(def.chartPadding).toBe(20);
    expect(def.pointChartPadding).toBe(20);
    expect(def.totalChartOffset).toBe(1);
    expect(def.statsBeforeFilter).toBe(true);

    const carCol = normalizeNumMatrixParams(LEGACY_PRESETS.num3dCarCol);
    expect(deriveGrid(carCol)).toEqual({ gridWidth: 10, gridHeight: 9, count: 90 });
    // ⚠️ 网格是 10×9，但 rotate90CW 的行列仍是 32 —— 原实现写死 32，carCol 走的
    // 也是它。这条断言锁的是"保留原样"，不是"这样是对的"；要修改这两项即可。
    expect(carCol.canvas2d.rotateHeight).toBe(32);
    expect(carCol.canvas2d.rotateWidth).toBe(32);
  });

  it('canvas2d 这一段恒定存在，走 sprite3d 时也算', () => {
    // Builder 的表单不必判后端 —— 形状总是在。
    const sprite = normalizeNumMatrixParams(LEGACY_PRESETS.fast256);
    expect(sprite.backend).toBe('sprite3d');
    expect(sprite.canvas2d.cellWidth).toBe(32);
    expect(sprite.canvas2d.rotationPresets).toEqual([0, Math.PI / 6, Math.PI / 3]);
  });

  it('嵌套参数缺省回落、越界夹回', () => {
    const empty = normalizeNumMatrixParams().canvas2d;
    expect(empty).toMatchObject({
      cellWidth: 32,
      cellHeight: 24,
      extraTop: 200,
      fontScale: 20,
      textHeight: 3,
      textColorMax: 30,
      colorValueScale: 5,
      blurSigma: 1.6,
      baseTiltDeg: 20,
    });

    const clamped = normalizeNumMatrixParams({
      canvas2d: { cellWidth: 1, extraTop: -50, blurSigma: 999, baseTiltDeg: 400 },
    }).canvas2d;
    expect(clamped.cellWidth).toBe(4);
    expect(clamped.extraTop).toBe(0);
    expect(clamped.blurSigma).toBe(20);
    expect(clamped.baseTiltDeg).toBe(180);

    // 坏值不该把默认值顶掉
    expect(normalizeNumMatrixParams({ canvas2d: { fontScale: 'abc' } }).canvas2d.fontScale)
      .toBe(20);
  });

  it('rotationPresets：空数组与非数组都回落默认三档', () => {
    const fallback = [0, Math.PI / 6, Math.PI / 3];
    expect(normalizeNumMatrixParams({ canvas2d: { rotationPresets: [] } })
      .canvas2d.rotationPresets).toEqual(fallback);
    expect(normalizeNumMatrixParams({ canvas2d: { rotationPresets: 'x' } })
      .canvas2d.rotationPresets).toEqual(fallback);
    // 给了就用给的，坏值逐项归 0（而不是整条丢掉）。
    expect(normalizeNumMatrixParams({ canvas2d: { rotationPresets: [1, 'x'] } })
      .canvas2d.rotationPresets).toEqual([1, 0]);
  });

  it('BACKENDS 是白名单，未知后端回落 sprite3d', () => {
    expect(BACKENDS).toEqual(['sprite3d', 'canvas2d', 'webgl']);
    BACKENDS.forEach((id) => {
      expect(normalizeNumMatrixParams({ backend: id }).backend).toBe(id);
    });
    expect(normalizeNumMatrixParams({ backend: 'webgl2' }).backend).toBe('sprite3d');
  });
});
