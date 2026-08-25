import { describe, expect, it } from 'vitest';

import { deriveGridSize } from '../renderers/pointGrid/core/params.js';
import {
  expandCoordinateGrid,
  interpolateCoordinateTable,
  isCoordinateTable,
  padCoordinateTable,
  toPointTable,
} from './coordinateGrid.js';

/** 造一张 rows×cols 的规则坐标表，X 随列递增、Y 随行递增，便于逐点验算。 */
function makeTable(rows, cols, { step = 10, z = 0 } = {}) {
  const table = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      table.push({ X: col * step, Y: row * step, Z: typeof z === 'function' ? z(row, col) : z });
    }
  }
  return table;
}

describe('isCoordinateTable', () => {
  it('接受实测导出的对象数组', () => {
    expect(isCoordinateTable([{ X: 1, Y: 2, Z: 0 }])).toBe(true);
  });

  it('接受字符串字段（原项目的 sitObj 就是字符串）', () => {
    expect(isCoordinateTable([{ X: '3528.398', Y: '-1489.942', Z: '0' }])).toBe(true);
  });

  it('Z 缺省也算可用：平面传感器常常只导两轴', () => {
    expect(isCoordinateTable([{ X: 1, Y: 2 }])).toBe(true);
  });

  it('长度不符时拒绝', () => {
    expect(isCoordinateTable([{ X: 1, Y: 2 }], 2)).toBe(false);
    expect(isCoordinateTable([{ X: 1, Y: 2 }], 1)).toBe(true);
  });

  it('拒绝空表、元组表和坏点', () => {
    expect(isCoordinateTable([])).toBe(false);
    expect(isCoordinateTable(null)).toBe(false);
    expect(isCoordinateTable([[1, 2]])).toBe(false);
    expect(isCoordinateTable([{ X: 1 }])).toBe(false);
    expect(isCoordinateTable([{ X: 'abc', Y: 2 }])).toBe(false);
  });
});

describe('padCoordinateTable', () => {
  it('按补边圈数放大尺寸', () => {
    const padded = padCoordinateTable(makeTable(4, 3), 4, 3, 2);
    expect(padded).toHaveLength((4 + 4) * (3 + 4));
  });

  it('order 为 0 时原样返回同样长度', () => {
    expect(padCoordinateTable(makeTable(3, 3), 3, 3, 0)).toHaveLength(9);
  });

  it('越界处夹取最近的边缘点而不是补零', () => {
    // 补零会在边缘拉出一片塌到原点的假点。
    const table = makeTable(2, 2, { step: 100 });
    const padded = padCoordinateTable(table, 2, 2, 1);
    // 补边后是 4×4，左上角那个点应当等于原始 (0,0) 点。
    expect(padded[0]).toEqual({ X: 0, Y: 0, Z: 0 });
    // 右下角应当等于原始 (1,1) 点。
    expect(padded[padded.length - 1]).toEqual({ X: 100, Y: 100, Z: 0 });
  });

  it('把字符串字段转成数值', () => {
    const padded = padCoordinateTable([{ X: '1.5', Y: '-2.5', Z: '3' }], 1, 1, 0);
    expect(padded[0]).toEqual({ X: 1.5, Y: -2.5, Z: 3 });
  });

  it('坏点归零而不抛错', () => {
    const padded = padCoordinateTable([{ X: 'abc', Y: null, Z: undefined }], 1, 1, 0);
    expect(padded[0]).toEqual({ X: 0, Y: 0, Z: 0 });
  });
});

describe('interpolateCoordinateTable', () => {
  it('按倍率放大点数', () => {
    const result = interpolateCoordinateTable(makeTable(4, 4), 4, 4, 2);
    expect(result).toHaveLength(8 * 8);
  });

  it('interp 为 1 时保持原值', () => {
    const table = makeTable(2, 2, { step: 10 });
    const result = interpolateCoordinateTable(table, 2, 2, 1);
    expect(result).toEqual(table);
  });

  it('中点是四邻的算术平均（双线性插值的定义）', () => {
    const table = [
      { X: 0, Y: 0, Z: 0 },
      { X: 10, Y: 0, Z: 0 },
      { X: 0, Y: 10, Z: 0 },
      { X: 10, Y: 10, Z: 0 },
    ];
    const result = interpolateCoordinateTable(table, 2, 2, 2);
    // 4×4 输出里 (row=1, col=1) 落在四点正中间。
    expect(result[1 * 4 + 1].X).toBeCloseTo(5);
    expect(result[1 * 4 + 1].Y).toBeCloseTo(5);
  });

  it('Z 轴独立插值，曲面起伏会跟着加密', () => {
    const table = [
      { X: 0, Y: 0, Z: 0 },
      { X: 10, Y: 0, Z: 100 },
      { X: 0, Y: 10, Z: 0 },
      { X: 10, Y: 10, Z: 100 },
    ];
    const result = interpolateCoordinateTable(table, 2, 2, 2);
    // 横向中点的 Z 应当是 0 和 100 的中值。
    expect(result[1].Z).toBeCloseTo(50);
  });
});

describe('expandCoordinateGrid', () => {
  it('输出长度等于渲染网格（与 deriveGridSize 一致）', () => {
    // deriveGridSize: amountX = num1 * interp + order * 2
    const rows = 16;
    const cols = 16;
    const interp = 2;
    const order = 4;
    const expanded = expandCoordinateGrid({
      table: makeTable(rows, cols),
      rows,
      cols,
      interp,
      order,
    });

    const amountX = rows * interp + order * 2;
    const amountY = cols * interp + order * 2;
    expect(expanded).toHaveLength(amountX * amountY);
  });

  it('16×16 / interp 2 / order 1 的规模与压力管线一致', () => {
    // 顺序是「先插值再补边」（与 interpSmall → addSide 对齐）：
    // 16*2 + 1*2 = 34 见方。原组件的 objdupli 是先补边（36×36），
    // 与压力网格对不上，见 coordinateGrid.js 文件头。
    const expanded = expandCoordinateGrid({
      table: makeTable(16, 16),
      rows: 16,
      cols: 16,
      interp: 2,
      order: 1,
    });
    expect(expanded).toHaveLength(34 * 34);
  });

  it('输出长度与 deriveGridSize 逐组一致', () => {
    // 坐标表必须与压力网格逐点对齐，这条是整个特性的正确性前提。
    const cases = [
      { rows: 16, cols: 16, interp: 2, order: 4 },
      { rows: 16, cols: 10, interp: 2, order: 2 },
      { rows: 10, cols: 10, interp: 4, order: 2 },
      { rows: 8, cols: 8, interp: 1, order: 0 },
    ];

    for (const { rows, cols, interp, order } of cases) {
      const expanded = expandCoordinateGrid({
        table: makeTable(rows, cols),
        rows,
        cols,
        interp,
        order,
      });
      const { total } = deriveGridSize({ num1: rows, num2: cols, interp, order });
      expect(expanded, `${rows}×${cols} interp${interp} order${order}`).toHaveLength(total);
    }
  });

  it('长度对不上时返回 null，让渲染器回落规则矩阵', () => {
    // 用尺寸不符的表插值出来的是一团乱麻，比退回等距网格更难排查。
    expect(expandCoordinateGrid({
      table: makeTable(4, 4),
      rows: 8,
      cols: 8,
    })).toBeNull();
  });

  it('输入不可用时返回 null 而不抛错', () => {
    for (const table of [null, undefined, [], [[1, 2]], [{ X: 'x', Y: 1 }]]) {
      expect(expandCoordinateGrid({ table, rows: 1, cols: 1 })).toBeNull();
    }
  });

  it('非法尺寸参数被夹到安全值而不是崩掉', () => {
    const expanded = expandCoordinateGrid({
      table: makeTable(2, 2),
      rows: 2,
      cols: 2,
      interp: 0,      // 会被夹到 1
      order: -5,      // 会被夹到 0
    });
    expect(expanded).toHaveLength(4);
  });

  it('保留曲面形状：Z 起伏在扩展后仍然单调', () => {
    // 造一个沿行方向抬升的弧面。
    const rows = 4;
    const cols = 4;
    const expanded = expandCoordinateGrid({
      table: makeTable(rows, cols, { z: (row) => row * 50 }),
      rows,
      cols,
      interp: 2,
      order: 0,
    });

    const width = cols * 2;
    // 同一列上，行号递增时 Z 不应下降。
    for (let row = 1; row < rows * 2; row += 1) {
      expect(expanded[row * width].Z).toBeGreaterThanOrEqual(expanded[(row - 1) * width].Z);
    }
  });
});

describe('toPointTable', () => {
  it('默认只输出平面两轴', () => {
    expect(toPointTable([{ X: 1, Y: 2, Z: 3 }])).toEqual([[1, 2]]);
  });

  it('includeZ 时输出三轴作为基础高度', () => {
    expect(toPointTable([{ X: 1, Y: 2, Z: 3 }], { includeZ: true })).toEqual([[1, 2, 3]]);
  });

  it('字符串字段转成数值', () => {
    expect(toPointTable([{ X: '1.5', Y: '2.5' }])).toEqual([[1.5, 2.5]]);
  });

  it('输入不可用时返回空数组', () => {
    expect(toPointTable(null)).toEqual([]);
    expect(toPointTable([])).toEqual([]);
  });
});
