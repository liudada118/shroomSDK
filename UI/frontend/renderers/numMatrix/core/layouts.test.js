/**
 * layouts.test.js - 点位铺排层与三份原实现的逐点一致性验证
 *
 * 方式与 `pipeline.test.js` 一致：把原实现的对应片段**逐字内联**成参照实现，
 * 再与 `layouts.js` 跑同一批输入逐点比对。参照实现刻意写成「抄」的样子
 * （包括那些就地改点表、重复赋值、变量遮蔽的写法），否则两边共享同一份代码，
 * 测试就退化成自我验证。
 *
 * **本文件存在的直接原因是一次真实的抄错。** 2026-08-06 第三轮把
 * `applyGlove147Layout` 抄进 `canvas2d.js` 时错了两处：
 *
 * 1. 列偏移 `+4/+2/+0/-2` 加到了全部 150 个点上 —— 原实现的循环是
 *    `for (j<5) for (k<15)`，上界 75，后 75 个点（那五条手指列）不参与；
 * 2. 大拇指那 15 个点（`i ∈ [60,75)`）盖成了 `row+1/+2/+3`，两份原实现
 *    一份是 `row/+5/+6/+7`、另一份是 `row+4/+5/+6/+7`，没有一份是那样。
 *
 * 两处都不会让代码报错，只让手套图形悄悄变形。所以这一层的验收标准不是
 * 「跑得通」而是「与原件逐点相同」，且**两个变体各钉一份原件**。
 */

import { describe, expect, it } from 'vitest';

import {
  FOOT_60_POINTS,
  GLOVE_147_BASE,
  GLOVE_147_POINTS,
  GLOVE_147_THUMB_ROWS_CANVAS2D,
  GLOVE_147_THUMB_ROWS_WEBGL,
  MATRIX_VIEWPORT,
  applyFootPointLayout,
  applyGlove147Layout,
  calcCellSize,
  calcRobotCellSize,
  footInterp,
  matrixViewportBounds,
  nextPOT,
  normalizeRawFrame,
  packRobotLayout,
  padGlove147Rows,
  pickByPositions,
  placeGloveRegion,
  transposeSquareMatrix,
} from './layouts.js';

/** 每次调用重建一份点表 —— 原实现就是这么做的，两份参照实现都要就地改它。 */
function freshPointArr() {
  return GLOVE_147_POINTS.map((point) => [point[0], point[1]]);
}

/** 两份参照实现共用的那段列偏移循环，`NumWs.jsx:211-228` 与 `Num2D.jsx:649-666` 逐字相同。 */
function legacyColumnShift(pointArr) {
  for (let j = 0; j < 5; j++) {
    for (let k = 0; k < 15; k++) {
      const index = j * 15 + k;
      if (k >= 3 * 1 && k < 3 * 2) {
        pointArr[index][1] = pointArr[index][1] + 4;
      }
      if (k >= 3 * 2 && k < 3 * 3) {
        pointArr[index][1] = pointArr[index][1] + 2;
      }
      if (k >= 3 * 3 && k < 3 * 4) {
        pointArr[index][1] = pointArr[index][1] + 0;
      }
      if (k >= 3 * 4 && k < 3 * 5) {
        pointArr[index][1] = pointArr[index][1] - 2;
      }
    }
  }
}

/**
 * `NumWs.jsx:230-248` 的参照实现，逐字照抄（canvas2d 后端的来源）。
 *
 * 关键在 `index` 是在 `pointArr[i][0] += 4` **之前**算好的，而那之后的
 * `j = 1..3` 循环读的是 `nowArr[0]`（`nowArr === pointArr[i]`，同一个对象）
 * 已经 `+4` 的值。于是这一支写的是 `row, row+5, row+6, row+7` —— `row+4` 从
 * 来没被写过，`row` 被写了两遍。
 */
function legacyGlove147NumWs(wsPointData) {
  const pointArr = freshPointArr();
  const newArr = new Array(1024).fill(0);
  legacyColumnShift(pointArr);

  for (let i = 0; i < pointArr.length; i++) {
    if (i >= 15 && i < 4 * 15) {
      pointArr[i][0] = pointArr[i][0] + Math.floor(i / 15);
    }

    const nowArr = pointArr[i];
    const index = nowArr[0] * 32 + nowArr[1];
    newArr[index] = wsPointData[i];
    if (i >= 4 * 15 && i < 5 * 15) {
      pointArr[i][0] = pointArr[i][0] + 4;
      newArr[index] = wsPointData[i];
      for (let j = 1; j < 4; j++) {
        const idx = (nowArr[0] + j) * 32 + nowArr[1];
        newArr[idx] = wsPointData[i];
      }
    } else {
      const idx = (nowArr[0] + 1) * 32 + nowArr[1];
      newArr[idx] = wsPointData[i];
    }
  }
  return newArr;
}

/**
 * `Num2D.jsx:668-694` 的参照实现，逐字照抄（webgl 后端的来源），
 * 包括那两层多余的块级作用域和被遮蔽的 `index`。
 *
 * 与上面那份的唯一差别：这一支没有 `+= 4` 之前的那次写入，且循环是
 * `j = 0..3`，所以写的是 `row+4, row+5, row+6, row+7`。
 */
function legacyGlove147Num2D(wsPointData) {
  const pointArr = freshPointArr();
  const newArr = new Array(1024).fill(0);
  legacyColumnShift(pointArr);

  for (let i = 0; i < pointArr.length; i++) {
    if (i >= 15 && i < 4 * 15) {
      pointArr[i][0] = pointArr[i][0] + Math.floor(i / 15);
      const nowArr = pointArr[i];
      const index = nowArr[0] * 32 + nowArr[1];
      newArr[index] = wsPointData[i];
    }

    const nowArr = pointArr[i];
    if (i >= 4 * 15 && i < 5 * 15) {
      pointArr[i][0] = pointArr[i][0] + 4;
      for (let j = 0; j < 4; j++) {
        const index = (nowArr[0] + j) * 32 + nowArr[1];
        newArr[index] = wsPointData[i];
      }
    } else {
      {
        const index = nowArr[0] * 32 + nowArr[1];
        newArr[index] = wsPointData[i];
      }
      const index = (nowArr[0] + 1) * 32 + nowArr[1];
      newArr[index] = wsPointData[i];
    }
  }
  return newArr;
}

/** `Num2D.jsx:14-43` 的 `footInterp` 参照实现，逐字照抄（含一位小数截断）。 */
function legacyFootInterp(arr, footPointArr) {
  const newArr = [...arr];
  for (let i = 0; i < 10; i++) {
    for (let j = 1; j < 6; j++) {
      const col = footPointArr[i * 6 + j][0];
      const length = footPointArr[i * 6 + j][1] - footPointArr[i * 6 + j - 1][1];
      const firstIndex = footPointArr[i * 6 + j - 1][1];
      const lastIndex = footPointArr[i * 6 + j][1];
      const firstValue = newArr[col * 16 + firstIndex];
      const lastValue = newArr[col * 16 + lastIndex];
      const cha = lastValue - firstValue;
      for (let k = 1; k < length; k++) {
        newArr[col * 16 + firstIndex + k] = firstValue + Math.floor((cha * 10) / length) / 10;
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const col = footPointArr[i * 6 + 0][0];
    const nextCol = footPointArr[(i + 1) * 6 + 0][0];
    const firstIndex = footPointArr[i * 6 + 0][1];
    const lastIndex = footPointArr[i * 6 + 5][1];
    for (let j = firstIndex; j <= lastIndex; j++) {
      newArr[(col + 1) * 16 + j] = newArr[col * 16 + j]
        + Math.floor(((newArr[nextCol * 16 + j] - newArr[col * 16 + j]) * 10 * 1) / 3) / 10;
      newArr[(col + 2) * 16 + j] = newArr[col * 16 + j]
        + Math.floor(((newArr[nextCol * 16 + j] - newArr[col * 16 + j]) * 10 * 2) / 3) / 10;
    }
  }
  return newArr;
}

/** 确定性伪随机帧：不用 Math.random，失败可复现。 */
function makeFrame(length, seed = 1) {
  let state = seed;
  return Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % 97;
  });
}

describe('手套 147 点位铺排', () => {
  const frames = [
    makeFrame(150, 1),
    makeFrame(150, 7),
    makeFrame(150, 99),
    new Array(150).fill(0),
    new Array(150).fill(40),
  ];

  it('canvas2d 变体与 NumWs.jsx 逐点相同', () => {
    frames.forEach((frame) => {
      expect(applyGlove147Layout(frame, {
        thumbRowOffsets: GLOVE_147_THUMB_ROWS_CANVAS2D,
      })).toEqual(legacyGlove147NumWs(frame));
    });
  });

  it('webgl 变体与 Num2D.jsx 逐点相同（也是缺省变体）', () => {
    frames.forEach((frame) => {
      expect(applyGlove147Layout(frame, {
        thumbRowOffsets: GLOVE_147_THUMB_ROWS_WEBGL,
      })).toEqual(legacyGlove147Num2D(frame));
      expect(applyGlove147Layout(frame)).toEqual(legacyGlove147Num2D(frame));
    });
  });

  it('两个变体的差集恰好是大拇指那 15 个点的 row 与 row+4 两格', () => {
    const frame = new Array(150).fill(0).map((_, i) => i + 1);
    const a = applyGlove147Layout(frame, { thumbRowOffsets: GLOVE_147_THUMB_ROWS_CANVAS2D });
    const b = applyGlove147Layout(frame, { thumbRowOffsets: GLOVE_147_THUMB_ROWS_WEBGL });

    // 期望差集直接从点表推：i ∈ [60,75) 不吃行递增（那一支是 i < 60），
    // 所以 row 就是点表原值；列吃 k = i % 15 的那档偏移。
    const columnShift = (k) => {
      if (k >= 3 && k < 6) return 4;
      if (k >= 6 && k < 9) return 2;
      if (k >= 9 && k < 12) return 0;
      if (k >= 12 && k < 15) return -2;
      return 0;
    };
    const expected = new Set();
    for (let i = 60; i < 75; i++) {
      const [row, baseCol] = GLOVE_147_POINTS[i];
      const col = baseCol + columnShift(i % 15);
      expected.add(row * GLOVE_147_BASE + col);
      expected.add((row + 4) * GLOVE_147_BASE + col);
    }

    const diff = a.reduce((acc, value, index) => {
      if (value !== b[index]) acc.push(index);
      return acc;
    }, []);
    expect(new Set(diff)).toEqual(expected);
    // canvas2d 亮 row 不亮 row+4，webgl 反之 —— 各 15 格，合计 30 格。
    expect(diff.length).toBe(30);
  });

  it('点表不被就地修改：连续两次调用结果相同', () => {
    const frame = makeFrame(150, 3);
    const first = applyGlove147Layout(frame);
    const second = applyGlove147Layout(frame);
    expect(second).toEqual(first);
    expect(GLOVE_147_POINTS[0]).toEqual([16, 30]);
    expect(GLOVE_147_POINTS[74]).toEqual([11, 3]);
  });

  it('列偏移只作用在前 75 个点上', () => {
    // 只点亮第 75 个点（第一条手指列的头），它必须落在点表原始列上，不带偏移。
    const frame = new Array(150).fill(0);
    frame[75] = 42;
    const laid = applyGlove147Layout(frame);
    const [row, col] = GLOVE_147_POINTS[75];
    expect(laid[row * GLOVE_147_BASE + col]).toBe(42);
    expect(laid[(row + 1) * GLOVE_147_BASE + col]).toBe(42);
  });
});

describe('手套子区域铺排', () => {
  it('finger 区域盖在第 13 行第 14 列起', () => {
    const frame = makeFrame(150, 5);
    const laid = placeGloveRegion(frame, { rows: [0, 4], cols: [6, 9], atRow: 13, atCol: 14 });
    expect(laid.length).toBe(1024);
    expect(laid[13 * 32 + 14]).toBe(frame[0 * 15 + 6]);
    expect(laid[16 * 32 + 16]).toBe(frame[3 * 15 + 8]);
  });

  it('palm 区域盖在第 13 行第 7 列起', () => {
    const frame = makeFrame(150, 11);
    const laid = placeGloveRegion(frame, { rows: [0, 5], cols: [0, 15], atRow: 13, atCol: 7 });
    expect(laid[13 * 32 + 7]).toBe(frame[0]);
    expect(laid[17 * 32 + 21]).toBe(frame[4 * 15 + 14]);
  });
});

describe('手套 15 列补位', () => {
  it('普通手套在第 75 位插三个 0 → 15×10', () => {
    const frame = makeFrame(147, 2);
    const { data, gridWidth, gridHeight } = padGlove147Rows(frame);
    expect(gridWidth).toBe(15);
    expect(gridHeight).toBe(10);
    expect(data.length).toBe(150);
    expect(data.slice(75, 78)).toEqual([0, 0, 0]);
    expect(data.slice(0, 75)).toEqual(frame.slice(0, 75));
    expect(data.slice(78)).toEqual(frame.slice(75));
  });

  it('整包手套补 / 截到 195 → 15×13', () => {
    const short = makeFrame(190, 4);
    const padded = padGlove147Rows(short, { fullPacket: true });
    expect(padded.gridHeight).toBe(13);
    expect(padded.data.length).toBe(195);
    expect(padded.data.slice(190)).toEqual([0, 0, 0, 0, 0]);

    const long = makeFrame(210, 4);
    expect(padGlove147Rows(long, { fullPacket: true }).data.length).toBe(195);
  });

  it('长度不足 189 时 fullPacket 不生效，回落到插 0 那支', () => {
    const { gridHeight } = padGlove147Rows(makeFrame(147, 6), { fullPacket: true });
    expect(gridHeight).toBe(10);
  });
});

describe('足底插值', () => {
  it('与 Num2D.jsx 的 footInterp 逐点相同', () => {
    [1, 13, 77].forEach((seed) => {
      const base = new Array(16 * 32).fill(0);
      const values = makeFrame(60, seed);
      FOOT_60_POINTS.forEach((point, index) => {
        base[point[0] * 16 + point[1]] = values[index];
      });
      expect(footInterp(base, FOOT_60_POINTS)).toEqual(legacyFootInterp(base, FOOT_60_POINTS));
    });
  });

  it('applyFootPointLayout 等于「按点表落点 + 插值」', () => {
    const values = makeFrame(60, 21);
    const base = new Array(16 * 32).fill(0);
    FOOT_60_POINTS.forEach((point, index) => {
      base[point[0] * 16 + point[1]] = values[index];
    });
    expect(applyFootPointLayout(values)).toEqual(legacyFootInterp(base, FOOT_60_POINTS));
  });

  it('不改入参', () => {
    const base = new Array(16 * 32).fill(0);
    base[FOOT_60_POINTS[0][0] * 16 + FOOT_60_POINTS[0][1]] = 50;
    const snapshot = [...base];
    footInterp(base, FOOT_60_POINTS);
    expect(base).toEqual(snapshot);
  });
});

describe('纹理与转置', () => {
  it('nextPOT', () => {
    expect([1, 2, 3, 6, 10, 14, 16, 17, 20, 32, 33, 64].map(nextPOT))
      .toEqual([1, 2, 4, 8, 16, 16, 16, 32, 32, 32, 64, 64]);
  });

  it('方阵转置是自反的', () => {
    const data = makeFrame(16, 8);
    expect(transposeSquareMatrix(transposeSquareMatrix(data, 4), 4)).toEqual(data);
  });

  it('长度对不上时原样返回副本', () => {
    const data = makeFrame(10, 8);
    const out = transposeSquareMatrix(data, 4);
    expect(out).toEqual(data);
    expect(out).not.toBe(data);
  });

  it('normalizeRawFrame 只在方阵时转置', () => {
    const square = makeFrame(16, 9);
    expect(normalizeRawFrame(square, { transpose: true, width: 4, height: 4 }))
      .toEqual(transposeSquareMatrix(square, 4));
    // 非方阵：即便要求转置也原样返回，这是原实现的条件。
    const rect = makeFrame(20, 9);
    expect(normalizeRawFrame(rect, { transpose: true, width: 5, height: 4 })).toEqual(rect);
    expect(normalizeRawFrame(square, { transpose: false, width: 4, height: 4 })).toEqual(square);
  });
});

describe('按下标表取值', () => {
  it('下标是 1 起点', () => {
    expect(pickByPositions([10, 20, 30], [1, 3])).toEqual([10, 30]);
  });

  it('越界与非数值补 0', () => {
    expect(pickByPositions([10, 20], [1, 5])).toEqual([10, 0]);
    expect(pickByPositions(['x', 20], [1, 2])).toEqual([0, 20]);
  });
});

describe('机器人分区拼接', () => {
  const partDefs = [
    { key: 'a', text: '甲', w: 2, h: 2, data: [1, 2, 3, 4] },
    { key: 'b', text: '乙', w: 3, h: 1, data: [5, 6, 7] },
  ];

  it('水平排布，宽度是各分区宽加间距，高度是最高分区 + 2', () => {
    const { layoutW, layoutH, partDefsWithOffset } = packRobotLayout(partDefs, 2);
    expect(layoutW).toBe(2 + 2 + 3);
    expect(layoutH).toBe(2 + 2);
    expect(partDefsWithOffset.map((d) => d.offsetX)).toEqual([0, 4]);
    expect(partDefsWithOffset.every((d) => d.offsetY === 0)).toBe(true);
  });

  it('mask 只在分区覆盖处为 255，间距与标题行为 0', () => {
    const { maskData, layoutW } = packRobotLayout(partDefs, 2);
    expect(maskData[0]).toBe(255);
    expect(maskData[2]).toBe(0);          // 间距列
    expect(maskData[4]).toBe(255);        // 第二块起点
    expect(maskData[2 * layoutW]).toBe(0); // 标题留白行
  });

  it('数据不足时补 0，不越界', () => {
    const { layoutData } = packRobotLayout(
      [{ key: 'a', text: '甲', w: 2, h: 2, data: [1, 2] }],
      2,
    );
    expect(Array.from(layoutData.slice(0, 4))).toEqual([1, 2, 0, 0]);
  });
});

describe('尺寸推导', () => {
  it('calcCellSize 取宽高较小者，下限 8', () => {
    expect(calcCellSize(16, 16, 800, 800, 40)).toBe(Math.floor(720 / 16));
    expect(calcCellSize(16, 32, 800, 800, 40)).toBe(Math.floor(720 / 32));
    expect(calcCellSize(64, 64, 100, 100, 40)).toBe(8);
  });

  it('calcRobotCellSize 夹在 [12, 35]', () => {
    expect(calcRobotCellSize(40, 10, 4000, 4000)).toBe(35);
    expect(calcRobotCellSize(400, 100, 200, 200)).toBe(12);
  });

  it('matrixViewportBounds 不读 window，宽高由入参决定', () => {
    const wide = matrixViewportBounds({ innerWidth: 1920, innerHeight: 1080 });
    expect(wide.maxH).toBe(1080 - MATRIX_VIEWPORT.verticalPadding);
    expect(wide.maxW).toBe(Math.floor(1920 * MATRIX_VIEWPORT.widthRatio));

    // 窄视口下 sidePanel + padding 那一支接手，且不低于 minWidth。
    const narrow = matrixViewportBounds({ innerWidth: 500, innerHeight: 300 });
    expect(narrow.maxW).toBeGreaterThanOrEqual(MATRIX_VIEWPORT.minWidth);
    expect(narrow.maxH).toBe(MATRIX_VIEWPORT.minHeight);

    // 机器人那条 0.6 宽比。
    expect(matrixViewportBounds({ innerWidth: 1920, innerHeight: 1080, widthRatio: 0.6 }).maxW)
      .toBeGreaterThan(wide.maxW);
  });
});
