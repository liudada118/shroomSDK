/**
 * pipeline.test.js - 参数化管线与原场景组件的逐帧一致性验证
 *
 * 验证方式是差分测试：把 matCol.jsx / carCol.jsx 中 sitRenew() 的
 * 三步变换按原样内联为参照实现（常量直接抄自这两个文件的常量区），
 * 再与参数化管线跑同一批输入，逐点比对。
 *
 * 参照实现刻意写成"抄"的样子而不是复用 pipeline.js，否则两边共享
 * 同一份代码，测试就退化成自我验证、证明不了任何东西。
 */

import { describe, expect, it } from 'vitest';

import { addSide, gaussBlur_1, interpSmall } from '../../../core/frameMath.js';
import { deriveGridSize, LEGACY_PRESETS, normalizePointGridParams } from './params.js';
import {
  buildPointGridBasePositions,
  createPointGridPipeline,
  runPointGridPipeline,
} from './pipeline.js';

/**
 * matCol.jsx 原实现的参照版本。
 *
 * 常量抄自 matCol.jsx:29-32，变换抄自 matCol.jsx:583-604。
 */
function referenceMatCol(ndata1, valueg1) {
  const sitnum1 = 16;
  const sitnum2 = 10;
  const sitInterp = 2;
  const sitOrder = 2;

  const AMOUNTX = sitnum1 * sitInterp + sitOrder * 2;
  const AMOUNTY = sitnum2 * sitInterp + sitOrder * 2;
  const bigArrg = new Array(AMOUNTX * AMOUNTY).fill(0);

  const bigArr = interpSmall(ndata1, sitnum2, sitnum1, sitInterp, sitInterp);
  const bigArrs = addSide(
    bigArr,
    sitnum2 * sitInterp,
    sitnum1 * sitInterp,
    sitOrder,
    sitOrder,
  );
  gaussBlur_1(
    bigArrs,
    bigArrg,
    sitnum2 * sitInterp + sitOrder * 2,
    sitnum1 * sitInterp + sitOrder * 2,
    valueg1,
  );
  return bigArrg;
}

/**
 * carCol.jsx 原实现的参照版本。
 *
 * 与 referenceMatCol 的唯一差别是 sitnum1 和 sitOrder 两个常量，
 * 抄自 carCol.jsx:29-32。
 */
function referenceCarCol(ndata1, valueg1) {
  const sitnum1 = 9;
  const sitnum2 = 10;
  const sitInterp = 2;
  const sitOrder = 4;

  const AMOUNTX = sitnum1 * sitInterp + sitOrder * 2;
  const AMOUNTY = sitnum2 * sitInterp + sitOrder * 2;
  const bigArrg = new Array(AMOUNTX * AMOUNTY).fill(0);

  const bigArr = interpSmall(ndata1, sitnum2, sitnum1, sitInterp, sitInterp);
  const bigArrs = addSide(
    bigArr,
    sitnum2 * sitInterp,
    sitnum1 * sitInterp,
    sitOrder,
    sitOrder,
  );
  gaussBlur_1(
    bigArrs,
    bigArrg,
    sitnum2 * sitInterp + sitOrder * 2,
    sitnum1 * sitInterp + sitOrder * 2,
    valueg1,
  );
  return bigArrg;
}

/**
 * 生成确定性伪随机压力帧，避免测试结果随机漂移。
 */
function makeFrame(length, seed) {
  const values = new Array(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values[i] = state % 4096;
  }
  return values;
}

describe('点阵管线与原场景组件逐帧一致', () => {
  it('物理坐标按 row-major 顺序生成居中的 3D 基础位置', () => {
    const positions = buildPointGridBasePositions({
      amountX: 2,
      amountY: 2,
      separation: 100,
      points: [[0, 0], [4, 0], [0, 2], [4, 2]],
    });
    expect(Array.from(positions)).toEqual([
      -50, 0, 25,
      50, 0, 25,
      -50, 0, -25,
      50, 0, -25,
    ]);
  });
  const blurRadii = [1, 2, 4];

  it('matCol：参数化管线输出与原实现逐点相同', () => {
    const params = normalizePointGridParams(LEGACY_PRESETS.matCol);
    const frameLength = params.sit.num1 * params.sit.num2;

    for (let seed = 1; seed <= 5; seed += 1) {
      const frame = makeFrame(frameLength, seed);
      for (const radius of blurRadii) {
        const expected = referenceMatCol(frame, radius);
        const actual = runPointGridPipeline(frame, params.sit, radius);
        expect(actual.length).toBe(expected.length);
        expect(actual).toEqual(expected);
      }
    }
  });

  it('carCol：参数化管线输出与原实现逐点相同', () => {
    const params = normalizePointGridParams(LEGACY_PRESETS.carCol);
    const frameLength = params.sit.num1 * params.sit.num2;

    for (let seed = 1; seed <= 5; seed += 1) {
      const frame = makeFrame(frameLength, seed);
      for (const radius of blurRadii) {
        const expected = referenceCarCol(frame, radius);
        const actual = runPointGridPipeline(frame, params.sit, radius);
        expect(actual.length).toBe(expected.length);
        expect(actual).toEqual(expected);
      }
    }
  });

  it('两个预设产出不同尺寸的网格，确认参数确实生效', () => {
    const matCol = deriveGridSize(normalizePointGridParams(LEGACY_PRESETS.matCol).sit);
    const carCol = deriveGridSize(normalizePointGridParams(LEGACY_PRESETS.carCol).sit);

    // 抄自原文件常量：matCol 16*2+2*2=36, 10*2+2*2=24
    expect(matCol).toEqual({ amountX: 36, amountY: 24, total: 864 });
    // carCol 9*2+4*2=26, 10*2+4*2=28
    expect(carCol).toEqual({ amountX: 26, amountY: 28, total: 728 });
  });

  it('复用缓冲区的执行器与一次性调用结果相同', () => {
    const params = normalizePointGridParams(LEGACY_PRESETS.matCol);
    const run = createPointGridPipeline(params.sit);
    const frameLength = params.sit.num1 * params.sit.num2;

    for (let seed = 1; seed <= 3; seed += 1) {
      const frame = makeFrame(frameLength, seed);
      const reused = run(frame, 2);
      const fresh = runPointGridPipeline(frame, params.sit, 2);
      expect([...reused]).toEqual(fresh);
    }
  });

  it('缓冲区复用不会残留上一帧数据', () => {
    const params = normalizePointGridParams(LEGACY_PRESETS.matCol);
    const run = createPointGridPipeline(params.sit);
    const frameLength = params.sit.num1 * params.sit.num2;

    const busy = makeFrame(frameLength, 7);
    run(busy, 2);

    const empty = new Array(frameLength).fill(0);
    const afterEmpty = [...run(empty, 2)];
    const freshEmpty = runPointGridPipeline(empty, params.sit, 2);

    expect(afterEmpty).toEqual(freshEmpty);
  });
});

describe('参数归一化', () => {
  it('缺省参数不会导致渲染失败', () => {
    const params = normalizePointGridParams({});
    expect(params.sit.num1).toBeGreaterThan(0);
    expect(params.sit.interp).toBeGreaterThan(0);
    expect(deriveGridSize(params.sit).total).toBeGreaterThan(0);
  });

  it('非法输入退回默认值而不是抛错', () => {
    const params = normalizePointGridParams({
      sit: { num1: 'abc', num2: null, interp: NaN, order: undefined },
      fps: -100,
    });
    expect(params.sit.num1).toBe(16);
    expect(params.sit.num2).toBe(10);
    expect(params.sit.interp).toBe(2);
    expect(params.fps).toBe(1);
  });

  it('超范围输入被夹到边界，避免顶点数爆炸', () => {
    const params = normalizePointGridParams({
      sit: { num1: 9999, interp: 9999, order: 9999 },
    });
    expect(params.sit.num1).toBe(128);
    expect(params.sit.interp).toBe(8);
    expect(params.sit.order).toBe(16);
  });

  it('点位表丢弃坏点而不是整体失败', () => {
    const params = normalizePointGridParams({
      points: [[1, 2], ['x', 3], [4], null, [5, 6]],
    });
    expect(params.points).toEqual([[1, 2], [5, 6]]);
  });

  it('无有效点位时返回 null，由渲染器决定退化行为', () => {
    expect(normalizePointGridParams({ points: [] }).points).toBeNull();
    expect(normalizePointGridParams({ points: [null, 'bad'] }).points).toBeNull();
  });
});
