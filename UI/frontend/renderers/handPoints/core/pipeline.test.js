/**
 * pipeline.test.js - 两条插值实现与原实现的逐点一致性验证
 *
 * 差分测试，参照实现逐字抄自：
 *
 * - `interpCentered` ← `client/src/assets/util/util.js:190-201`（导出名就叫 `interp`）
 * - `interpRamp`     ← `client/src/components/three/hand0205Point147.jsx:32-78`
 *   （**同名不同实现**，那个是文件内的局部函数）
 *
 * 除此之外这里还钉一条别的测试都钉不到的事：**这两个 `interp` 和
 * `core/frameMath.js` 的 `interpSmall` 三者互不相同。** 迁移计划原文写的是
 * 「147 变体里那份本地重复的 26 行 `interp` 直接删，用 `core/frameMath.js` 的」——
 * 那条被这里的 `三份 interp 互不相同` 用例证伪了，所以两份都搬了进来。
 * 将来有人再想"去重"，先看这条会不会红。
 */

import { describe, expect, it } from 'vitest';

import { interpSmall } from '../../../core/frameMath.js';
import { INTERP_MODES, interpCentered, interpRamp } from './pipeline.js';

/** `util.js:190-201` 的参照版本，逐字抄（包括就地写 `bigMat`、`* 10`、居中偏移）。 */
function referenceInterpCentered(smallMat, bigMat, Length, num) {
  for (let x = 1; x <= Length; x++) {
    for (let y = 1; y <= Length; y++) {
      bigMat[
        Length * num * (num * (y - 1))
        + (Length * num * num) / 2
        + num * (x - 1)
        + num / 2
      ] = smallMat[Length * (y - 1) + x - 1] * 10;
    }
  }
}

/**
 * `hand0205Point147.jsx:32-78` 的参照版本，逐字抄。
 *
 * 保留了原实现第一遍里那个**算了不用**的 `colValue`（`pipeline.js` 没搬它）——
 * 留在参照里正好证明「不搬」确实不改结果。注释掉的三段丢弃，它们不参与计算。
 */
function referenceInterpRamp(smallMat, width, height, interp1, interp2) {
  const bigMat = new Array((width * interp1) * (height * interp2)).fill(0);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const realValue = smallMat[i * width + j] * 10;
      const rowValue = smallMat[i * width + j + 1] * 10 ? smallMat[i * width + j + 1] * 10 : 0;
      // eslint-disable-next-line no-unused-vars
      const colValue = smallMat[(i + 1) * width + j] * 10 ? smallMat[(i + 1) * width + j] * 10 : 0;
      bigMat[(width * interp1) * i * interp2 + (j * interp1)] = smallMat[i * width + j] * 10;
      for (let k = 0; k < interp1; k++) {
        bigMat[(width * interp1) * (i * interp2) + ((j * interp1 + k))] = realValue
          + (rowValue - realValue) * (k) / interp1;
      }
    }
  }

  const newWidth = width * interp1;

  for (let i = 0; i < height; i++) {
    for (let j = 0; j < newWidth; j++) {
      const realValue = bigMat[i * interp2 * newWidth + j];
      const colValue = bigMat[((i + 1) * interp2) * newWidth + j]
        ? bigMat[(((i + 1) * interp2) + 1) * newWidth + j]
        : 0;
      for (let k = 0; k < interp2; k++) {
        bigMat[newWidth * (i * interp2 + k) + ((j))] = realValue
          + (colValue - realValue) * (k) / interp2;
      }
    }
  }
  return bigMat;
}

/**
 * 造一批可复现的输入。不用 `Math.random()` —— 测试要可复现，而且失败时要能
 * 一眼看出喂的是什么。
 */
function makeFrame(size, seed) {
  return Array.from({ length: size * size }, (_, i) => ((i * seed) % 37) * 3);
}

/** 手套那条真实的形状：32×32、大部分是 0、手形区域有值。 */
function makeSparseFrame(size) {
  const arr = new Array(size * size).fill(0);
  for (let i = 0; i < size * size; i += 7) arr[i] = (i % 23) + 1;
  return arr;
}

describe('interpCentered（hand0205 预设）', () => {
  it.each([
    ['32×32 interp 2', 32, 2],
    ['32×32 interp 4', 32, 4],
    ['8×8 interp 2', 8, 2],
  ])('与原实现逐点一致：%s', (_label, size, num) => {
    const frame = makeFrame(size, 5);
    // 原实现的目标数组初值是 fill(1) 而不是 fill(0)，两边都照这个来。
    const mine = new Array(size * num * size * num).fill(1);
    const ref = new Array(size * num * size * num).fill(1);
    interpCentered(frame, mine, size, num);
    referenceInterpCentered(frame, ref, size, num);
    expect(mine).toEqual(ref);
  });

  it('稀疏帧（手套的真实形状）也一致', () => {
    const frame = makeSparseFrame(32);
    const mine = new Array(64 * 64).fill(1);
    const ref = new Array(64 * 64).fill(1);
    interpCentered(frame, mine, 32, 2);
    referenceInterpCentered(frame, ref, 32, 2);
    expect(mine).toEqual(ref);
  });

  it('就地写入，没有返回值', () => {
    const bigMat = new Array(16).fill(1);
    expect(interpCentered([1, 2, 3, 4], bigMat, 2, 2)).toBeUndefined();
    expect(bigMat.some((v) => v !== 1), '确实写进去了').toBe(true);
  });

  it('⚠️ 没被覆盖的格子永远保持初值 1 —— 那个 1 会一路走进高斯模糊', () => {
    // 这不是 bug 是现状（见 pipeline.js 头部第 1 条）。跨帧复用的数组 + fill(1)
    // 初值，是手套点云底噪的来源。
    const bigMat = new Array(4 * 4).fill(1);
    interpCentered([1, 2, 3, 4], bigMat, 2, 2);
    expect(bigMat.filter((v) => v === 1).length).toBeGreaterThan(0);
  });

  it('值被放大十倍 —— 后面所有阈值都是按放大后的量纲写的', () => {
    const bigMat = new Array(4 * 4).fill(0);
    interpCentered([7, 0, 0, 0], bigMat, 2, 2);
    expect(bigMat).toContain(70);
  });

  it('跨帧复用：第二帧不会残留第一帧的值（同一批格子被覆盖）', () => {
    const bigMat = new Array(64 * 64).fill(1);
    interpCentered(makeFrame(32, 5), bigMat, 32, 2);
    const after1 = bigMat.slice();
    interpCentered(makeFrame(32, 5), bigMat, 32, 2);
    expect(bigMat, '同样的输入必须给出同样的结果').toEqual(after1);
  });
});

describe('interpRamp（hand0205_147 预设）', () => {
  it.each([
    ['32×32 interp 4', 32, 32, 4, 4],
    ['32×32 interp 2', 32, 32, 2, 2],
    ['非方阵 10×16', 10, 16, 2, 3],
  ])('与原实现逐点一致：%s', (_label, width, height, interp1, interp2) => {
    const frame = Array.from({ length: width * height }, (_, i) => ((i * 11) % 41) * 2);
    expect(interpRamp(frame, width, height, interp1, interp2))
      .toEqual(referenceInterpRamp(frame, width, height, interp1, interp2));
  });

  it('稀疏帧（手套的真实形状）也一致', () => {
    const frame = makeSparseFrame(32);
    expect(interpRamp(frame, 32, 32, 4, 4))
      .toEqual(referenceInterpRamp(frame, 32, 32, 4, 4));
  });

  it('输出长度是 width * interp1 * height * interp2', () => {
    expect(interpRamp(makeFrame(8, 3), 8, 8, 4, 4)).toHaveLength(8 * 4 * 8 * 4);
  });

  it('不改调用方的源数组', () => {
    const frame = makeFrame(8, 3);
    const copy = frame.slice();
    interpRamp(frame, 8, 8, 2, 2);
    expect(frame).toEqual(copy);
  });

  it('全零帧给出全零', () => {
    const out = interpRamp(new Array(64).fill(0), 8, 8, 2, 2);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('行方向确实填出了斜坡（这是它与另两个 interp 的本质区别）', () => {
    // 源 1×2：[1, 3] → ×10 → 10 和 30，interp1 = 4 时第一行应当是
    // 10, 15, 20, 25, 30, 30, 30, 30（后四格的 rowValue 越界读到 undefined → 0，
    // 但 realValue 是 30，斜坡是 30 → 0）。这里只钉前四格是严格递增的斜坡。
    const out = interpRamp([1, 3], 2, 1, 4, 1);
    expect(out.slice(0, 5)).toEqual([10, 15, 20, 25, 30]);
  });

  it('⚠️ 列方向那个差一行的坑还在 —— 斜坡几乎总是往 0 收', () => {
    // 见 pipeline.js 头部：判空看 `(i+1)*interp2` 行，取值取 `+1` 行。
    // 两行两列、interp2 = 2：第 0 行是源值，第 1 行应当是往 0 收的中点，
    // 而不是往第 1 行源值收。
    const out = interpRamp([5, 5, 5, 5], 2, 2, 1, 2);
    // 第 0 行：[50, 50]；第 1 行：realValue 50 → colValue 0 的中点 = 25。
    expect(out.slice(0, 2)).toEqual([50, 50]);
    expect(out.slice(2, 4), '若"修正"成往下一行源值收，这里会是 [50, 50]')
      .toEqual([25, 25]);
  });
});

describe('三份 interp 互不相同（计划里那条"直接删"被这条证伪）', () => {
  const frame = makeFrame(8, 5);

  it('interpRamp 与 interpSmall 结果不同', () => {
    const ramp = interpRamp(frame, 8, 8, 2, 2);
    const small = interpSmall(frame, 8, 8, 2, 2);
    expect(ramp).not.toEqual(small);
  });

  it('interpSmall 是稀疏散点，interpRamp 是填满的', () => {
    const nonZero = (arr) => arr.filter((v) => v).length;
    // 8×8 → 16×16 = 256 格，稀疏散点只写 64 格。
    expect(nonZero(interpSmall(frame, 8, 8, 2, 2))).toBeLessThan(80);
    expect(nonZero(interpRamp(frame, 8, 8, 2, 2))).toBeGreaterThan(150);
  });

  it('interpCentered 与 interpSmall 都稀疏，但落格位置不同（居中偏移）', () => {
    const centered = new Array(16 * 16).fill(0);
    interpCentered(frame, centered, 8, 2);
    const small = interpSmall(frame, 8, 8, 2, 2);
    const cells = (arr) => arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(cells(centered), '两者写的格子集合不同').not.toEqual(cells(small));
  });
});

describe('INTERP_MODES', () => {
  it('就是那两条，和 params 的枚举对得上', () => {
    expect(INTERP_MODES).toEqual(['centered', 'ramp']);
  });
});
