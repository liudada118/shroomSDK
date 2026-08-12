/**
 * pipeline.test.js - 斑点热力帧运算与原实现的逐点一致性验证
 *
 * 差分测试。参照实现逐字抄自：
 *
 * - `clearEdges` / `mirrorRows` / `applyFloor` ← `client/src/components/webgl/
 *   Canvas4096WebGL.jsx` 的 `renderFrame`（三段写死 64 的循环）
 * - `buildHeatPoints` ← `client/src/components/webgl/WebGL.HeatMap copy 2.js`
 *   的 `genWebglHeatmap`（写死 `dataHeight = 64, dataWidth = 64` 与 `* 1.8`）
 * - `frameStats` ← `Canvas4096WebGL.updatePressureStats`
 *
 * 参照实现保留了原件的全部写死值，被测实现全部参数化 —— 用例把参数填成那些写死
 * 值，两边必须逐点相等。这是"搬家不改画面"的机器证明。
 */

import { describe, expect, it } from 'vitest';

import {
  applyFloor,
  buildHeatPoints,
  clearEdges,
  frameStats,
  mirrorRows,
  prepareFrame,
  pushWindow,
} from './pipeline.js';
import { LEGACY_PRESETS, normalizeWebglHeatmapParams } from './params.js';

/** `Canvas4096WebGL.renderFrame` 的参照版本，逐字抄（含写死的 64 / 6 / 58 / 32）。 */
function referenceRenderFrame(rawData, filter) {
  let resArr = [...rawData];
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 64; j++) {
      if ((i < 6 || i > 58) || (j < 6 || j > 58)) resArr[i * 64 + j] = 0;
    }
  }
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 32; j++) {
      const tmp = resArr[i * 64 + j];
      resArr[i * 64 + j] = resArr[i * 64 + 63 - j];
      resArr[i * 64 + 63 - j] = tmp;
    }
  }
  resArr = resArr.map((a) => (a < filter ? 0 : a));
  return resArr;
}

/** `genWebglHeatmap` 铺点那一段的参照版本，逐字抄。 */
function referenceGenPoints(dataArr, canvasWidth, canvasHeight) {
  const dataHeight = 64;
  const dataWidth = 64;
  const arr = [];
  for (let i = 0; i < dataHeight; i++) {
    for (let j = 0; j < dataWidth; j++) {
      arr.push([
        j * (canvasWidth / dataWidth),
        i * (canvasHeight / dataHeight),
        dataArr[i * dataWidth + j] ? dataArr[i * dataWidth + j] * 1.8 : 0,
      ]);
    }
  }
  return arr;
}

/** `updatePressureStats` 的参照版本，逐字抄。 */
function referenceStats(arr) {
  const max = arr.reduce((a, b) => (a > b ? a : b), 0);
  const point = arr.filter((a) => a > 0).length;
  const press = arr.reduce((a, b) => a + b, 0);
  const mean = press / (point === 0 ? 1 : point);
  return {
    meanPres: mean.toFixed(2),
    maxPres: max,
    point,
    totalPres: press,
  };
}

/** 造一帧确定性数据（不用随机，失败要能复现）。 */
function makeFrame(length = 4096) {
  return Array.from({ length }, (unused, index) => (index * 37) % 211);
}

describe('clearEdges', () => {
  it('把窗口外的行列全部置 0，窗口内一个不动', () => {
    const values = Array.from({ length: 16 }, (unused, i) => i + 1);
    const result = clearEdges(values, 4, 4, 1, 2);
    expect(result).toEqual([
      0, 0, 0, 0,
      0, 6, 7, 0,
      0, 10, 11, 0,
      0, 0, 0, 0,
    ]);
  });

  it('不改原数组', () => {
    const values = [1, 2, 3, 4];
    clearEdges(values, 2, 2, 1, 1);
    expect(values).toEqual([1, 2, 3, 4]);
  });

  it('⚠️ 默认窗口 [6, 58] 对 64 来说不对称 —— 上切 6 行、下切 5 行', () => {
    const values = new Array(64 * 64).fill(1);
    const result = clearEdges(values, 64, 64, 6, 58);
    const clearedTop = [0, 1, 2, 3, 4, 5].every((row) => result[row * 64 + 30] === 0);
    const clearedBottom = [59, 60, 61, 62, 63].every((row) => result[row * 64 + 30] === 0);
    expect(clearedTop).toBe(true);
    expect(clearedBottom).toBe(true);
    // 第 58 行留着、第 5 行没留 —— 这就是"不对称"的具体样子。
    expect(result[58 * 64 + 30]).toBe(1);
    expect(result[5 * 64 + 30]).toBe(0);
  });
});

describe('mirrorRows', () => {
  it('每行首尾对调', () => {
    expect(mirrorRows([1, 2, 3, 4, 5, 6], 3, 2)).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it('偶数宽也对', () => {
    expect(mirrorRows([1, 2, 3, 4], 4, 1)).toEqual([4, 3, 2, 1]);
  });

  it('镜两次等于没镜', () => {
    const values = makeFrame(64);
    expect(mirrorRows(mirrorRows(values, 8, 8), 8, 8)).toEqual(values);
  });
});

describe('applyFloor', () => {
  it('小于下限的归零', () => {
    expect(applyFloor([0, 5, 9, 10, 20], 10)).toEqual([0, 0, 0, 10, 20]);
  });

  it('下限为 0 时原样返回（原件的 `a < 0` 恒假）', () => {
    expect(applyFloor([0, 1, 2], 0)).toEqual([0, 1, 2]);
  });
});

describe('prepareFrame 与原实现逐点一致', () => {
  const params = normalizeWebglHeatmapParams(LEGACY_PRESETS.bed4096);

  it.each([0, 1, 40, 200])('filter = %i 时结果相同', (filter) => {
    const raw = makeFrame();
    expect(prepareFrame(raw, { ...params, filter })).toEqual(referenceRenderFrame(raw, filter));
  });

  it('不改原数组', () => {
    const raw = makeFrame();
    const copy = [...raw];
    prepareFrame(raw, params);
    expect(raw).toEqual(copy);
  });

  it('edgeClear 传 null 就不清边', () => {
    const raw = makeFrame();
    const kept = prepareFrame(raw, { ...params, edgeClear: null, mirrorX: false, filter: 0 });
    expect(kept).toEqual(raw);
  });

  it('mirrorX 传 false 就不镜像', () => {
    const raw = makeFrame();
    const noMirror = prepareFrame(raw, { ...params, mirrorX: false, filter: 0 });
    const mirrored = prepareFrame(raw, { ...params, filter: 0 });
    expect(mirrorRows(noMirror, 64, 64)).toEqual(mirrored);
  });
});

describe('buildHeatPoints 与原实现逐点一致', () => {
  const params = normalizeWebglHeatmapParams(LEGACY_PRESETS.bed4096);

  it('bed4096 预设下点表完全相同', () => {
    const values = prepareFrame(makeFrame(), params);
    expect(buildHeatPoints(values, params)).toEqual(
      referenceGenPoints(values, params.canvasWidth, params.canvasHeight),
    );
  });

  it('点数 = dataWidth × dataHeight', () => {
    const small = normalizeWebglHeatmapParams({ dataWidth: 8, dataHeight: 5 });
    expect(buildHeatPoints(new Array(40).fill(1), small)).toHaveLength(40);
  });

  it('缺数据的位置给 0，不给 NaN', () => {
    const small = normalizeWebglHeatmapParams({ dataWidth: 2, dataHeight: 2, valueScale: 2 });
    expect(buildHeatPoints([3], small).map((point) => point[2])).toEqual([6, 0, 0, 0]);
  });
});

describe('frameStats 与原实现逐点一致', () => {
  it.each([
    ['正常帧', makeFrame(256)],
    ['全 0 帧', new Array(256).fill(0)],
    ['空帧', []],
  ])('%s', (unusedLabel, values) => {
    expect(frameStats(values)).toEqual(referenceStats(values));
  });

  it('没有受压点时按 1 除，不出 NaN', () => {
    expect(frameStats(new Array(16).fill(0)).meanPres).toBe('0.00');
  });

  it('入参不是数组时不炸', () => {
    expect(frameStats(undefined).point).toBe(0);
  });
});

describe('pushWindow', () => {
  it('未满时只追加', () => {
    const window = [];
    pushWindow(window, 1, 3);
    pushWindow(window, 2, 3);
    expect(window).toEqual([1, 2]);
  });

  it('满了丢最早的一个，长度不变', () => {
    const window = [1, 2, 3];
    pushWindow(window, 4, 3);
    expect(window).toEqual([2, 3, 4]);
  });

  it('返回的就是同一个数组（原地修改，与原件一致）', () => {
    const window = [];
    expect(pushWindow(window, 1, 3)).toBe(window);
  });
});
