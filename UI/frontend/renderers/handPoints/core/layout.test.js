/**
 * layout.test.js - 手形掩码与原实现的逐格一致性验证
 *
 * 方式和 `../pointGrid/pipeline.test.js` 一样是差分测试：把
 * `hand0205Point.jsx:490-553` 与 `hand0205Point147.jsx:568-578` 的盖点循环**逐字
 * 内联**成参照实现（`32` 这个魔数、`newZeroArr` 这个名字、`i == 2` 这种写法全部照抄，
 * 连越界写入一起），再与 `layout.js` 的参数化版本逐格比对。
 *
 * 参照实现刻意写成"抄"的样子而不是复用 `layout.js`，否则两边共享同一份代码，
 * 测试就退化成自我验证。
 *
 * 这一份比 pipeline 那份更值得写：掩码决定「哪些点被沉到画面外」，错一格就是手形
 * 缺一块，而缺一块在真机上未必看得出来是 bug —— 看起来只是"这个手套标定得不太好"。
 */

import { describe, expect, it } from 'vitest';

import { rotate90CCW } from '../../../core/frameMath.js';
import {
  GLOVES_POINTS,
  GLOVES_POINTS_ALT,
  HAND_POINT_ARR_147,
  MASK_MODES,
  MASK_VALUE,
  POINT_TABLES,
  buildGlovesMask,
  buildHandPointMask147,
} from './layout.js';

/**
 * `hand0205Point.jsx:490-553` 的参照版本。
 *
 * 逐字抄，包括：`new Array(1024)`、五段循环的顺序、`i == 2` 那个额外补三格、
 * 两种写法都等于 46 的循环边界（`30 + 8 * 2` 与 `3 * 10 + 2 * 8`）、
 * 以及 `col - 1/-2/-3` 与 `row + 5` 的越界写入。末尾的 `rotate90` 也照抄
 * （核心那份叫 `rotate90CCW`，是同一段代码搬过去的，见 frameMath.js 头部）。
 */
function referenceGlovesMask(glovesPoints) {
  let newZeroArr = new Array(1024).fill(0);

  // 四指头
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 6; j++) {
      const index = i * 10 + j;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 1) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 2) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 3) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 4) * 32 + glovesPoints[index][1]] = 5;
    }
  }

  for (let i = 0; i < 3; i++) {
    for (let j = 6; j < 8; j++) {
      const index = i * 10 + j;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 1) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 2) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 3) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 4) * 32 + glovesPoints[index][1]] = 5;
      if (i == 2) {
        newZeroArr[(glovesPoints[index][0] + 5) * 32 + glovesPoints[index][1]] = 5;
        newZeroArr[(glovesPoints[index][0] + 5) * 32 + glovesPoints[index][1] - 1] = 5;
        newZeroArr[(glovesPoints[index][0] + 5) * 32 + glovesPoints[index][1] - 2] = 5;
      }
    }
  }

  // 拇指
  for (let i = 0; i < 3; i++) {
    for (let j = 8; j < 10; j++) {
      const index = i * 10 + j;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1] - 1] = 5;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1] - 2] = 5;
      newZeroArr[glovesPoints[index][0] * 32 + glovesPoints[index][1] - 3] = 5;
      newZeroArr[(glovesPoints[index][0] + 1) * 32 + glovesPoints[index][1]] = 5;
      newZeroArr[(glovesPoints[index][0] + 1) * 32 + glovesPoints[index][1] - 1] = 5;
    }
  }

  for (let i = 30; i < 30 + 8 * 2; i++) {
    newZeroArr[glovesPoints[i][0] * 32 + glovesPoints[i][1]] = 5;
    newZeroArr[(glovesPoints[i][0] + 1) * 32 + glovesPoints[i][1]] = 5;
    newZeroArr[(glovesPoints[i][0] + 2) * 32 + glovesPoints[i][1]] = 5;
    newZeroArr[glovesPoints[i][0] * 32 + glovesPoints[i][1] - 1] = 5;
    newZeroArr[(glovesPoints[i][0] + 1) * 32 + glovesPoints[i][1] - 1] = 5;
    newZeroArr[(glovesPoints[i][0] + 2) * 32 + glovesPoints[i][1] - 1] = 5;
  }

  for (let i = 3 * 10 + 2 * 8; i < 3 * 10 + 2 * 8 + 5 * 10; i++) {
    newZeroArr[glovesPoints[i][0] * 32 + glovesPoints[i][1]] = 5;
    newZeroArr[(glovesPoints[i][0] + 1) * 32 + glovesPoints[i][1] + 1] = 5;
    newZeroArr[(glovesPoints[i][0] + 1) * 32 + glovesPoints[i][1] - 1] = 5;
    newZeroArr[glovesPoints[i][0] * 32 + glovesPoints[i][1] + 1] = 5;
    newZeroArr[glovesPoints[i][0] * 32 + glovesPoints[i][1] - 1] = 5;
  }

  newZeroArr = rotate90CCW(newZeroArr, 32, 32);
  return newZeroArr;
}

/**
 * `hand0205Point147.jsx:568-578` 的参照版本。
 *
 * 那边的点表在**每一帧**都现算一遍 `.map((a) => [a[0] + 1, a[1]])`；这里为了对齐
 * `layout.js`（模块加载时算一次）把 `+1` 直接写进参照循环，等价。
 */
function referenceHand147Mask(handPointArr) {
  const newZeroArr = new Array(1024).fill(0);
  handPointArr.forEach((a) => {
    newZeroArr[a[0] * 32 + (31 - a[1])] = 5;
    newZeroArr[(a[0] + 1) * 32 + (31 - a[1])] = 5;
  });
  return newZeroArr;
}

describe('gloves 掩码：与原实现逐格一致', () => {
  it('GLOVES_POINTS（hand0205 预设）', () => {
    expect(buildGlovesMask(GLOVES_POINTS, rotate90CCW, 32))
      .toEqual(referenceGlovesMask(GLOVES_POINTS));
  });

  it('GLOVES_POINTS_ALT（原 glovesPoints1，那行注释掉的死数据）', () => {
    // 原实现里这张表只有 `// glovesPoints = glovesPoints1` 一行注释能启用它。
    // 参照实现走的是同一段循环，所以这条测的是「换表也走得通」。
    expect(buildGlovesMask(GLOVES_POINTS_ALT, rotate90CCW, 32))
      .toEqual(referenceGlovesMask(GLOVES_POINTS_ALT));
  });

  it('两张表给出的掩码不同 —— 它们是两次标定，不是同一张表', () => {
    expect(buildGlovesMask(GLOVES_POINTS, rotate90CCW, 32))
      .not.toEqual(buildGlovesMask(GLOVES_POINTS_ALT, rotate90CCW, 32));
  });
});

describe('hand147 掩码：与原实现逐格一致', () => {
  it('HAND_POINT_ARR_147', () => {
    expect(buildHandPointMask147(HAND_POINT_ARR_147, 32))
      .toEqual(referenceHand147Mask(HAND_POINT_ARR_147));
  });

  it('镜像烘在下标里，所以不过 rotate90 —— 与 gloves 那条结果不同', () => {
    expect(buildHandPointMask147(HAND_POINT_ARR_147, 32))
      .not.toEqual(buildGlovesMask(GLOVES_POINTS, rotate90CCW, 32));
  });
});

describe('点表本身的形状', () => {
  it('两张关节表都是 3×10 + 2×8 + 5×10 = 96 项', () => {
    // ⚠️ 96 而不是 100 —— 字面量排版看着像 10 行 × 10 列，但第 4、5 行只有 8 项。
    // 盖点循环的边界（`i * 10 + j`、`i < 30 + 8 * 2`、`i < 3 * 10 + 2 * 8 + 5 * 10`）
    // 硬编码了这个分区，多一项少一项都会让后两段读到 undefined 并在解构时抛。
    expect(3 * 10 + 2 * 8 + 5 * 10).toBe(96);
    expect(GLOVES_POINTS).toHaveLength(96);
    expect(GLOVES_POINTS_ALT).toHaveLength(96);
  });

  it('表短一项，第五段就会抛 —— 不是静默画错', () => {
    const truncated = GLOVES_POINTS.slice(0, 95);
    expect(() => buildGlovesMask(truncated, rotate90CCW, 32)).toThrow();
  });

  it('147 表是 147 项（名字里的 147 就是这个数），且末尾那个 +1 已经烘进去了', () => {
    expect(HAND_POINT_ARR_147).toHaveLength(147);
    // 原表首项是 [21, 3]，`.map((a) => [a[0] + 1, a[1]])` 之后是 [22, 3]。
    expect(HAND_POINT_ARR_147[0]).toEqual([22, 3]);
  });

  it('147 表里有 5 个重复项 —— 原实现如此，照抄不删', () => {
    const seen = new Set();
    let dupes = 0;
    HAND_POINT_ARR_147.forEach(([row, col]) => {
      const key = `${row},${col}`;
      if (seen.has(key)) dupes += 1;
      seen.add(key);
    });
    expect(dupes).toBe(5);
  });

  it('所有下标都在 0-31 内（越界靠盖点循环产生，不靠点表）', () => {
    [...GLOVES_POINTS, ...GLOVES_POINTS_ALT, ...HAND_POINT_ARR_147].forEach(([row, col]) => {
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(32);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(32);
    });
  });

  it('POINT_TABLES 三个键与 params 的枚举对得上', () => {
    expect(Object.keys(POINT_TABLES).sort()).toEqual(['gloves', 'glovesAlt', 'hand147']);
    expect(POINT_TABLES.gloves).toBe(GLOVES_POINTS);
    expect(POINT_TABLES.glovesAlt).toBe(GLOVES_POINTS_ALT);
    expect(POINT_TABLES.hand147).toBe(HAND_POINT_ARR_147);
  });

  it('MASK_MODES 是那两条，MASK_VALUE 是 5', () => {
    expect(MASK_MODES).toEqual(['gloves', 'hand147']);
    expect(MASK_VALUE).toBe(5);
  });
});

describe('掩码的值域与越界行为', () => {
  it('掩码只有 0 和 5 两种值', () => {
    const values = new Set(buildGlovesMask(GLOVES_POINTS, rotate90CCW, 32));
    expect([...values].sort((a, b) => a - b)).toEqual([0, MASK_VALUE]);
  });

  /**
   * `put()` 一处边界检查都没有（`col - 3` 为负就跨行、`row + 5` 超界就撑数组），
   * 但**实测两张随包点表都不会真的踩到**。这条把实测出来的范围钉住：
   * 一旦有人改点表或改盖法踩出了 32×32，这里会红，而不是在真机上表现为
   * 「这个手套标定得不太好」。
   */
  it('两张随包点表的写入全部落在 32×32 内', () => {
    [GLOVES_POINTS, GLOVES_POINTS_ALT].forEach((table) => {
      const raw = buildGlovesMask(table, (a) => a, 32);
      expect(raw, '没有被撑长，说明没有 row 越界').toHaveLength(1024);
      // 没有 col 跨行：跨行会让某个「该是 0」的格子变成 5。逐格比对已由上面那两条
      // 差分测试覆盖，这里只钉长度与值域。
      expect([...new Set(raw)].sort((a, b) => a - b)).toEqual([0, MASK_VALUE]);
    });
  });

  it('rotate90CCW 之后长度回到 1024', () => {
    expect(buildGlovesMask(GLOVES_POINTS, rotate90CCW, 32)).toHaveLength(1024);
    expect(buildHandPointMask147(HAND_POINT_ARR_147, 32)).toHaveLength(1024);
  });

  it('注入 rotate 是个真的扩展点：传恒等函数就能单看盖点结果', () => {
    const spy = [];
    buildGlovesMask(GLOVES_POINTS, (arr, h, w) => { spy.push([h, w]); return arr; }, 32);
    expect(spy).toEqual([[32, 32]]);
  });
});

describe('rotate90CCW（掩码是它全仓唯一的调用点）', () => {
  it('3×3 方阵逆时针转 90°', () => {
    // 1 2 3        3 6 9
    // 4 5 6   →    2 5 8
    // 7 8 9        1 4 7
    expect(rotate90CCW([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3))
      .toEqual([3, 6, 9, 2, 5, 8, 1, 4, 7]);
  });

  it('转四次回到原样', () => {
    let arr = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 0; i < 4; i += 1) arr = rotate90CCW(arr, 3, 3);
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('⚠️ 非方阵会静默给出错位结果 —— 原实现的坑，照抄保留', () => {
    // 2 行 3 列。行跨距用的是 `height`(2) 而不是 `width`(3)，两层循环又都跑到行数，
    // 所以输出既不是 3×2 也不是任何合理的东西。钉住它是为了防止有人"顺手修正"
    // ——`layout.js` 只传 32×32，修了不影响画面，但那是另一件事、要单独做。
    const out = rotate90CCW([1, 2, 3, 4, 5, 6], 2, 3);
    expect(out).toEqual([2, 4, 1, 3]);
  });
});
