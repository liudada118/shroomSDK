/**
 * rainbowLadder.test.js - 彩虹阶梯的四条「必须照抄」行为
 *
 * 与 `jetLadder.test.js` 同一个理由：这条阶梯是手部点云唯一的配色出处，而它有四处
 * 反直觉的行为（`if (!x)` 把 0 判成白、`min` 没被用上、`* 2` 系数、倒着取索引）。
 * 这些不是 bug 而是现在的观感，所以要有断言钉住它们 —— 否则哪天有人"顺手修正"，
 * 手套点云的画面会整体变样，而测试全绿。
 *
 * 断言里的期望值全部是从 `rainbowTextColorsxy` 那张表**手算**出来的（表在文件里
 * 是字面量，索引可以直接数），不是把实现跑一遍抄下来的。
 */

import { describe, expect, it } from 'vitest';

import { jetWhite3, rainbowTextColorsxy } from './rainbowLadder.js';

/** 表长。`...new Array(5).fill(...)` 展开之后是 18 + 5 + 3。 */
const LEN = 26;

describe('rainbowTextColorsxy 这张表', () => {
  it('26 级：18 + 蓝 ×5 + 白 ×3', () => {
    expect(rainbowTextColorsxy).toHaveLength(LEN);
    expect(rainbowTextColorsxy.slice(18, 23)).toEqual(new Array(5).fill([0, 102, 255]));
    expect(rainbowTextColorsxy.slice(23)).toEqual(new Array(3).fill([255, 255, 255]));
  });

  it('表头是红、表尾是白 —— 索引倒着取，所以值越大越红', () => {
    expect(rainbowTextColorsxy[0]).toEqual([255, 0, 0]);
    expect(rainbowTextColorsxy[LEN - 1]).toEqual([255, 255, 255]);
  });

  it('每一项都是三个 0-255 的整数', () => {
    rainbowTextColorsxy.forEach((rgb, i) => {
      expect(rgb, `第 ${i} 项`).toHaveLength(3);
      rgb.forEach((c) => {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      });
    });
  });

  it('是离散查表而不是连续插值 —— 别拿 jetRgb 替换它', () => {
    // 相邻两级之间的跳变是 51 或 69 这种整数台阶，不是平滑过渡。
    expect(rainbowTextColorsxy[1]).toEqual([255, 69, 0]);
    expect(rainbowTextColorsxy[6]).toEqual([204, 255, 0]);
  });
});

describe('jetWhite3 的四条照抄行为', () => {
  it('① x 为 0 走 `if (!x)` 那一支，返回白', () => {
    // 压力为 0 的点因此是白的 —— 这就是手套点云的底色。
    expect(jetWhite3(0, 100, 0)).toEqual([255, 255, 255]);
  });

  it('① NaN / undefined / null 也走那一支（都是 falsy）', () => {
    [NaN, undefined, null, false, ''].forEach((x) => {
      expect(jetWhite3(0, 100, x), `x = ${String(x)}`).toEqual([255, 255, 255]);
    });
  });

  it('② min 参数不参与索引计算 —— 只影响 count，不做减法', () => {
    // count = (max - min) * 2 / 26。min 变了 count 就变，但 x 不减 min。
    // max=100/min=0 → count = 200/26 ≈ 7.69；max=100/min=50 → count = 100/26 ≈ 3.85。
    // 同一个 x=20 因此落在不同的格：floor(20/7.69)=2 与 floor(20/3.85)=5。
    expect(jetWhite3(0, 100, 20)).toEqual(rainbowTextColorsxy[LEN - 1 - 2]);
    expect(jetWhite3(50, 100, 20)).toEqual(rainbowTextColorsxy[LEN - 1 - 5]);
    // 如果实现改成 `x - min`，第二条会变成 floor((20-50)/3.85) < 0 → 夹到 0 → 白。
    expect(jetWhite3(50, 100, 20)).not.toEqual([255, 255, 255]);
  });

  it('③ `* 2` 系数：值域后一半全部夹在最红那级', () => {
    // count = (100 - 0) * 2 / 26 ≈ 7.6923，走到表头需要 num >= 25，
    // 即 x >= 25 * 7.6923 ≈ 192.3 —— 远超 max。实际上 x 到 max 的一半上方
    // 就已经很红了：x=50 → floor(50/7.6923) = 6 → 索引 26-1-6 = 19。
    expect(jetWhite3(0, 100, 50)).toEqual(rainbowTextColorsxy[19]);
    // x = max = 100 → floor(13) = 13 → 索引 12，还没到表头。
    expect(jetWhite3(0, 100, 100)).toEqual(rainbowTextColorsxy[12]);
    // 超过 max 一倍才走到表头（最红）。
    expect(jetWhite3(0, 100, 200)).toEqual(rainbowTextColorsxy[0]);
    expect(jetWhite3(0, 100, 1e9)).toEqual([255, 0, 0]);
  });

  it('④ 索引倒着取：单调不减的 x 给出单调不增的索引', () => {
    const indexOf = (x) => rainbowTextColorsxy.indexOf(jetWhite3(0, 100, x));
    let prev = LEN;
    for (let x = 1; x <= 200; x += 1) {
      const idx = indexOf(x);
      expect(idx, `x = ${x} 的索引反而变大了`).toBeLessThanOrEqual(prev);
      prev = idx;
    }
  });
});

describe('jetWhite3 的边界与返回值语义', () => {
  it('负数夹到 num = 0 → 表尾（白）', () => {
    expect(jetWhite3(0, 100, -5)).toEqual(rainbowTextColorsxy[LEN - 1]);
  });

  it('返回的是表里那个数组本身，不是副本', () => {
    // 原实现如此，所有调用点都只读。这条钉住它，是因为渲染器每帧调它几千次，
    // 改成返回副本就是每帧几千次分配。
    expect(jetWhite3(0, 100, 200)).toBe(rainbowTextColorsxy[0]);
    expect(jetWhite3(0, 100, 0)).toBe(rainbowTextColorsxy[LEN - 1]);
  });

  it('max === min 时 count 为 0，x/0 = Infinity → 夹到表头', () => {
    // 除零不抛，走的是 `>= length - 1` 那一支。手套点云的阈值滑块可以拖到
    // 上下界相等，所以这条路径是真会走到的。
    expect(jetWhite3(50, 50, 10)).toEqual(rainbowTextColorsxy[0]);
  });

  it('所有取样结果都在表里', () => {
    for (let x = -50; x <= 300; x += 3) {
      expect(rainbowTextColorsxy).toContain(jetWhite3(0, 100, x));
    }
  });
});
