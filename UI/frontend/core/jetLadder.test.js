/**
 * jetLadder.test.js - jet 阶梯的三份表达必须同解
 *
 * 全仓 jet 只允许有一个出处，但它现在有**三种表达形式**：
 *
 * 1. `jetRgb()` —— 那条分支阶梯本身，18 处老配色的运行期实现；
 * 2. `JET_LADDER_SEGMENTS` —— 同一条阶梯的声明式副本，供代码生成用；
 * 3. `glslJetLadder()` 发出来的 GLSL —— webgl 后端的片元着色器用。
 *
 * 三份不是「一份实现 + 两份包装」，是**三份平行的东西**，所以必须有测试把它们
 * 钉在一起：`jetRgb` 的注释写着「不要改动它的数值」，把它改成表驱动就是在改那
 * 18 处的实现，收益为零；于是只能并存，靠这个文件防止悄悄分家。
 *
 * 第 3 份没法在 Node 里执行（没有 GLSL 解释器），所以对它的验收分两层：
 * **原件的 GLSL 原文逐字内联在下面当基准**，比对(a)有意义的数字常量集合完全
 * 相同，(b)生成结果与一份显式期望字符串完全相同。后者是"改了就红"的闸门 ——
 * 生成器一动，必须有人重新看一眼这段 GLSL 再改期望值。
 */

import { describe, expect, it } from 'vitest';

import { glslJetLadder } from './colormaps.js';
import { JET_LADDER_SEGMENTS, jetLadderSegmentRgb, jetRgb } from './jetLadder.js';

/**
 * `Num2D.jsx:98-124` 的片元着色器里那份 `jet1`，**逐字内联**。
 * `Num2Doriginal.jsx` 里那份与它一字不差（两文件的着色器差异全在 mask 与
 * 零值显白，不在这个函数里）。
 */
const LEGACY_GLSL_JET1 = `
  vec3 jet1(float minVal, float maxVal, float x) {
    if (x < minVal) x = minVal;
    if (x > maxVal) x = maxVal;
    float dv = maxVal - minVal;
    if (dv == 0.0) return vec3(0.0, 0.0, 1.0);
    float t = (x - minVal) / dv;

    float r = 1.0, g = 1.0, b = 1.0;
    if (t < 0.25) {
      r = 0.0;
      g = 4.0 * t;
      b = 1.0;
    } else if (t < 0.5) {
      r = 0.0;
      g = 1.0;
      b = 1.0 - 4.0 * (t - 0.25);
    } else if (t < 0.75) {
      r = 4.0 * (t - 0.5);
      g = 1.0;
      b = 0.0;
    } else {
      r = 1.0;
      g = 1.0 - 4.0 * (t - 0.75);
      b = 0.0;
    }
    return vec3(r, g, b);
  }
`;

/**
 * 取一段 GLSL 里用到的**不同**数字常量（取绝对值），排序去重。
 *
 * 比的是"有没有出现新的魔数"，不是字面量个数 —— 后者会因为两处纯写法差异而
 * 不等，两者都不影响求值：原件写 `1.0 - 4.0 * (…)`，生成器写
 * `1.0 + -4.0 * (…)`（所以取绝对值）；原件还多三个
 * `float r = 1.0, g = 1.0, b = 1.0;` 的初值（所以去重）。
 */
function numericConstants(source) {
  const found = (source.match(/-?\d+\.\d+/g) || []).map((literal) => Math.abs(Number(literal)));
  return [...new Set(found)].sort((a, b) => a - b);
}

describe('jet 阶梯：JS 两份表达同解', () => {
  it('JET_LADDER_SEGMENTS 逐点等于 jetRgb(0, 1, t)', () => {
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const expected = jetRgb(0, 1, t);
      const actual = jetLadderSegmentRgb(t);
      expect(actual.r).toBeCloseTo(expected.r, 12);
      expect(actual.g).toBeCloseTo(expected.g, 12);
      expect(actual.b).toBeCloseTo(expected.b, 12);
    }
  });

  it('断点上走的是下一段（`<` 而非 `<=`），与 jetRgb 一致', () => {
    [0.25, 0.5, 0.75].forEach((breakpoint) => {
      const expected = jetRgb(0, 1, breakpoint);
      const actual = jetLadderSegmentRgb(breakpoint);
      expect(actual.r).toBeCloseTo(expected.r, 12);
      expect(actual.g).toBeCloseTo(expected.g, 12);
      expect(actual.b).toBeCloseTo(expected.b, 12);
    });
  });

  it('超界被夹到 [0, 1]', () => {
    expect(jetLadderSegmentRgb(-5)).toEqual(jetLadderSegmentRgb(0));
    expect(jetLadderSegmentRgb(9)).toEqual(jetLadderSegmentRgb(1));
  });

  it('四段，斜率只有 ±4，断点是 0.25 / 0.5 / 0.75 / 1', () => {
    expect(JET_LADDER_SEGMENTS.map((s) => s.until)).toEqual([0.25, 0.5, 0.75, 1]);
    JET_LADDER_SEGMENTS.forEach((segment) => {
      [segment.r, segment.g, segment.b].forEach((spec) => {
        if (typeof spec === 'number') expect([0, 1]).toContain(spec);
        else expect([4, -4]).toContain(spec.slope);
      });
    });
  });
});

describe('jet 阶梯：生成的 GLSL 与原件同解', () => {
  const generated = glslJetLadder();

  it('没有引入原件之外的魔数', () => {
    expect(numericConstants(generated)).toEqual(numericConstants(LEGACY_GLSL_JET1));
    // 就这六个：三个断点、斜率 4、两个端点值。
    expect(numericConstants(generated)).toEqual([0, 0.25, 0.5, 0.75, 1, 4]);
  });

  it('保留原件的序言：先夹 x，再 dv == 0 提前返回纯蓝，再相除', () => {
    // 这三行是逐字照抄的，`clamp()` 那种"更干净"的写法在 maxVal < minVal 时不同解。
    expect(generated).toContain('if (x < minVal) x = minVal;');
    expect(generated).toContain('if (x > maxVal) x = maxVal;');
    expect(generated).toContain('if (dv == 0.0) return vec3(0.0, 0.0, 1.0);');
    expect(generated).toContain('float t = (x - minVal) / dv;');
    expect(generated).not.toContain('clamp(');
  });

  it('最后一段不带条件 —— 否则 t == 1.0 会漏掉', () => {
    expect(generated.match(/if \(t < /g)).toHaveLength(3);
    expect(generated).toContain('if (t < 0.25)');
    expect(generated).toContain('if (t < 0.5)');
    expect(generated).toContain('if (t < 0.75)');
    expect(generated).not.toContain('if (t < 1.0)');
  });

  it('函数名可换，默认是原件那个 jet1', () => {
    expect(generated).toContain('vec3 jet1(float minVal, float maxVal, float x)');
    expect(glslJetLadder('pressColor')).toContain('vec3 pressColor(');
  });

  it('生成结果逐字锁定 —— 改了生成器必须重看这段 GLSL 再改这里', () => {
    expect(generated).toBe(`vec3 jet1(float minVal, float maxVal, float x) {
  if (x < minVal) x = minVal;
  if (x > maxVal) x = maxVal;
  float dv = maxVal - minVal;
  // dv == 0 时 JS 侧的 g 是 NaN，GLSL 侧历来返回纯蓝；照抄 GLSL，画面零变化。
  if (dv == 0.0) return vec3(0.0, 0.0, 1.0);
  float t = (x - minVal) / dv;
  if (t < 0.25) {
    return vec3(0.0, 0.0 + 4.0 * (t - 0.0), 1.0);
  }
  if (t < 0.5) {
    return vec3(0.0, 1.0, 1.0 + -4.0 * (t - 0.25));
  }
  if (t < 0.75) {
    return vec3(0.0 + 4.0 * (t - 0.5), 1.0, 0.0);
  }
    return vec3(1.0, 1.0 + -4.0 * (t - 0.75), 0.0);
}`);
  });

  it('把生成的 GLSL 当算式解出来，与 jetRgb 逐点相同', () => {
    // 不解析 GLSL，而是把上面锁定的四段表达式按同样的次序在 JS 里复算一遍。
    // 生成器如果换了斜率或断点，上一条断言先红；这一条守的是"这些数确实构成 jet"。
    const evalGenerated = (t) => {
      if (t < 0.25) return { r: 0.0, g: 0.0 + 4.0 * (t - 0.0), b: 1.0 };
      if (t < 0.5) return { r: 0.0, g: 1.0, b: 1.0 + -4.0 * (t - 0.25) };
      if (t < 0.75) return { r: 0.0 + 4.0 * (t - 0.5), g: 1.0, b: 0.0 };
      return { r: 1.0, g: 1.0 + -4.0 * (t - 0.75), b: 0.0 };
    };
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const expected = jetRgb(0, 1, t);
      const actual = evalGenerated(t);
      expect(actual.r).toBeCloseTo(expected.r, 12);
      expect(actual.g).toBeCloseTo(expected.g, 12);
      expect(actual.b).toBeCloseTo(expected.b, 12);
    }
  });
});
