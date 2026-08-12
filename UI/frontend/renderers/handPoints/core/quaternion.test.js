/**
 * quaternion.test.js - 「首帧归零」跟踪器的代数与四条照抄行为
 *
 * ## 为什么这一份不是差分测试
 *
 * 包内其它管线测试（`../pointGrid/pipeline.test.js` 等）都是把原实现逐字内联成参照
 * 版本再逐点比对。这里做不到：原实现用的是 `THREE.Quaternion`，而 `three` 是本包的
 * **可选 peer 依赖**、不在 devDependencies 里，`sdk/frontend/node_modules` 里根本没有
 * 它 —— 测试一旦 `import * as THREE from 'three'` 就直接跑不起来。
 *
 * 手抄一份 three 的 `multiplyQuaternions` 当参照也没有意义：那八行与
 * `quaternion.js` 里的写法逐项同形，抄过来就是自我验证。
 *
 * 所以这里换一条路：**用能手算出精确值的旋转（绕轴 90°、180°）钉代数，再逐条钉
 * 文件头那四处「必须照抄」的行为。** 前者证明乘法与求逆没写错分量顺序，后者证明
 * 搬家没有顺手"修正"原实现。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createQuaternionTracker,
  identityQuaternion,
  invertQuaternion,
  lengthSq,
  multiplyQuaternions,
} from './quaternion.js';

/** 绕 Z 轴 90°：`[0, 0, sin45, cos45]`。 */
const ROT_Z_90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
/** 绕 X 轴 90°。 */
const ROT_X_90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

function expectClose(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => {
    expect(actual[i]).toBeCloseTo(value, 12);
  });
}

describe('四元数代数', () => {
  it('乘单位元不变（左乘、右乘都试）', () => {
    expectClose(multiplyQuaternions(ROT_Z_90, identityQuaternion()), ROT_Z_90);
    expectClose(multiplyQuaternions(identityQuaternion(), ROT_Z_90), ROT_Z_90);
  });

  it('绕同一轴两次 90° = 一次 180°', () => {
    expectClose(multiplyQuaternions(ROT_Z_90, ROT_Z_90), [0, 0, 1, 0]);
  });

  it('乘自己的逆得单位元', () => {
    expectClose(multiplyQuaternions(invertQuaternion(ROT_X_90), ROT_X_90), identityQuaternion());
  });

  it('不可交换 —— 分量顺序写错这条就会绿', () => {
    const ab = multiplyQuaternions(ROT_X_90, ROT_Z_90);
    const ba = multiplyQuaternions(ROT_Z_90, ROT_X_90);
    // xyz 三个分量里至少有一个不等（w 在这个例子里恰好相同）。
    expect(ab.slice(0, 3)).not.toEqual(ba.slice(0, 3));
    expect(ab[3]).toBeCloseTo(ba[3], 12);
  });

  it('invert 是共轭而不是真逆 —— 非单位四元数上模长不变', () => {
    // 见 quaternion.js 的警告：three 的 invert() 不除模长平方，这里照抄。
    const q = [1, 2, 3, 4];
    expect(invertQuaternion(q)).toEqual([-1, -2, -3, 4]);
    expect(lengthSq(invertQuaternion(q))).toBe(lengthSq(q));
    // 真逆会让这个乘积是单位元；共轭不会。
    expect(multiplyQuaternions(invertQuaternion(q), q)).not.toEqual(identityQuaternion());
  });

  it('lengthSq 与 identityQuaternion', () => {
    expect(lengthSq(identityQuaternion())).toBe(1);
    expect(lengthSq([1, 2, 3, 4])).toBe(30);
    // 每次返回新数组：调用方改了不该污染下一次。
    const a = identityQuaternion();
    a[0] = 9;
    expect(identityQuaternion()).toEqual([0, 0, 0, 1]);
  });
});

describe('跟踪器：四条必须照抄的行为', () => {
  /**
   * 基准取单位元时，`transform` 退化成「交换前两位 + x 取负」——
   * 于是①和③可以在同一个断言里被看见，且是精确值不是近似值。
   *
   * `[0, 0, 0, 1]` 交换前两位后仍是 `[0, 0, 0, 1]`，所以首帧喂单位元就能把基准
   * 钉成单位元。
   */
  it('① + ③ 前两位交换、返回值 x 取负', () => {
    const tracker = createQuaternionTracker({ warn: () => {} });
    tracker.transform(identityQuaternion());

    // 交换 → [0.2, 0.1, 0.3, 0.4]，x 取负 → [-0.2, 0.1, 0.3, 0.4]。
    // 少了交换，第一位会是 -0.1；少了取负，第一位会是 +0.2。
    expectClose(tracker.transform([0.1, 0.2, 0.3, 0.4]), [-0.2, 0.1, 0.3, 0.4]);
  });

  it('① 不就地改调用方传进来的数组', () => {
    const tracker = createQuaternionTracker({ warn: () => {} });
    const input = [0.1, 0.2, 0.3, 0.4];
    tracker.transform(input);
    expect(input, '原实现会就地改；搬进包时刻意改成了不改').toEqual([0.1, 0.2, 0.3, 0.4]);
    // 第二帧也不改。
    tracker.transform(input);
    expect(input).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('② 首帧一律返回单位元，并把首帧存成基准', () => {
    const tracker = createQuaternionTracker({ warn: () => {} });
    expect(tracker.hasBase()).toBe(false);
    expect(tracker.transform(ROT_Z_90)).toEqual([0, 0, 0, 1]);
    expect(tracker.hasBase()).toBe(true);
  });

  it('喂与基准相同的一帧，得回单位元（乘的是共轭，所以 w = 模长平方）', () => {
    const tracker = createQuaternionTracker({ warn: () => {} });
    // 单位四元数：conj(q) * q = [0, 0, 0, 1]。
    tracker.transform(ROT_Z_90);
    expectClose(tracker.transform(ROT_Z_90), [0, 0, 0, 1]);

    // 非单位四元数：w 是模长平方而不是 1 —— 这正是 invert 只做共轭的可观测后果。
    const loose = createQuaternionTracker({ warn: () => {} });
    const q = [0.1, 0.2, 0.3, 0.4];
    loose.transform(q);
    expectClose(loose.transform(q), [0, 0, 0, lengthSq(q)]);
  });

  it('④ 基准模长为 0 时告警并返回单位元', () => {
    const warn = vi.fn();
    const tracker = createQuaternionTracker({ warn });
    tracker.transform([0, 0, 0, 0]); // 首帧就是全零 → 基准模长 0
    expect(warn).not.toHaveBeenCalled(); // 首帧走的是「存基准」那一支，不告警

    expect(tracker.transform(ROT_Z_90)).toEqual([0, 0, 0, 1]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/zero/i);
  });

  it('reset() 让下一帧重新取基准 —— 这就是 resetHand 命令', () => {
    const tracker = createQuaternionTracker({ warn: () => {} });
    tracker.transform(identityQuaternion());
    expect(tracker.transform(ROT_Z_90)).not.toEqual([0, 0, 0, 1]);

    tracker.reset();
    expect(tracker.hasBase()).toBe(false);
    // 重新取基准的那一帧又是单位元，之后喂同一个四元数也是单位元（基准已换）。
    expect(tracker.transform(ROT_Z_90)).toEqual([0, 0, 0, 1]);
    expectClose(tracker.transform(ROT_Z_90), [0, 0, 0, 1]);
  });

  it('默认 warn 走 console.warn（不传 options 也不该炸）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tracker = createQuaternionTracker();
    tracker.transform([0, 0, 0, 0]);
    tracker.transform(ROT_Z_90);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
