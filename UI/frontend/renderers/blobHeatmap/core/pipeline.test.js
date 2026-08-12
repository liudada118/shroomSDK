/**
 * renderers/blobHeatmap/core/pipeline.test.js - 与原实现的差分测试
 *
 * 参照物是 `client/src/components/heatmap/canvas.jsx` 的 `generateData`（64-136）
 * 与 `draw`（166-199）。下面把这两段**逐字**内联成 `reference*`，再断言新实现
 * 点对点相同 —— 这是「搬家不改画面」这句话的证据，不是复述。
 *
 * 最要紧的一条是 `死运算删掉之后逐点相同`：它把「那 50 行确实没人读」这件事钉死。
 */

import { describe, expect, it } from 'vitest';

import { buildBlobPoints, frameStats, groupByAlpha } from './pipeline.js';

/* ── 原实现的逐字内联 ────────────────────────────────────────────── */

/**
 * `canvas.jsx:64-136` 的 `generateData`，逐字保留那条死链再取原始 `arr` 铺点。
 *
 * @param {number[]} arr 一帧。
 * @param {number} width 宽。
 * @param {number} height 高。
 * @param {{width: number, height: number}} canvas 画布尺寸。
 * @param {{valuef1: number, valuelInit1: number}} thresholds 阈值。
 * @returns {Array<{x: number, y: number, value: number}>} 点表。
 */
function referenceGenerateData(arr, width, height, canvas, thresholds) {
  // ↓↓↓ 这一段是原件算了但从没读过的（旋转 / 过滤 / 置零）。故意留着，
  //     用来证明它对结果没有影响。
  const newArr = arr.map((a) => (a > thresholds.valuef1 ? a : 0));
  const total = newArr.reduce((sum, item) => sum + item, 0);
  // eslint-disable-next-line no-unused-vars
  const resArr = total < thresholds.valuelInit1 ? new Array(1024).fill(0) : newArr;
  // ↑↑↑ resArr 之后再无读点。

  const data = [];
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const obj = {};
      obj.x = (i * canvas.width) / width;
      obj.y = (j * canvas.height) / height;
      obj.value = arr[i * width + j];
      data.push(obj);
    }
  }
  return data;
}

/**
 * `canvas.jsx:166-199` 的 `draw` 里那段分桶，逐字。
 *
 * @param {Array<{value: number}>} data 点表。
 * @param {number} max 满值。
 * @returns {object} 以 alpha 字符串为键的桶。
 */
function referenceGroup(data, max) {
  const alphaMap = {};
  for (let i = 0; i < data.length; i += 1) {
    const alpha = Math.min(1, data[i].value / max).toFixed(2);
    if (!alphaMap[alpha]) alphaMap[alpha] = [];
    alphaMap[alpha].push(data[i]);
  }
  return alphaMap;
}

/** 一帧确定性数据，值域 0..210，含 0。 */
function makeFrame(length) {
  return Array.from({ length }, (_, i) => (i * 37) % 211);
}

/* ── 用例 ───────────────────────────────────────────────────────── */

describe('buildBlobPoints', () => {
  const canvas = { width: 648, height: 648 };

  it('死运算删掉之后逐点相同（32×32）', () => {
    const frame = makeFrame(1024);
    const expected = referenceGenerateData(frame, 32, 32, canvas, {
      valuef1: 2, valuelInit1: 2,
    });
    expect(buildBlobPoints(frame, 32, 32, canvas.width, canvas.height))
      .toEqual(expected);
  });

  it('那四个阈值取任何值都不改变结果 —— 它们喂的整条链是死的', () => {
    const frame = makeFrame(1024);
    const base = buildBlobPoints(frame, 32, 32, canvas.width, canvas.height);
    [
      { valuef1: 0, valuelInit1: 0 },
      { valuef1: 200, valuelInit1: 999999 },
      { valuef1: 1e9, valuelInit1: 1e9 },
    ].forEach((thresholds) => {
      expect(referenceGenerateData(frame, 32, 32, canvas, thresholds))
        .toEqual(base);
    });
  });

  it('carCol 的 10×9 也逐点相同', () => {
    const frame = makeFrame(90);
    const expected = referenceGenerateData(frame, 10, 9, canvas, {
      valuef1: 2, valuelInit1: 2,
    });
    expect(buildBlobPoints(frame, 10, 9, canvas.width, canvas.height))
      .toEqual(expected);
  });

  it('点数 = height × width', () => {
    expect(buildBlobPoints(makeFrame(90), 10, 9, 100, 100)).toHaveLength(90);
  });

  it('坐标公式的错位照抄下来了：行下标配宽、列下标配高', () => {
    // 10 宽 9 高：i 走到 8，x 最大 8*100/10 = 80（到不了 100）；
    // j 走到 9，y 最大 9*100/9 = 100（正好出界一格）。
    const points = buildBlobPoints(makeFrame(90), 10, 9, 100, 100);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.max(...xs)).toBe(80);
    expect(Math.max(...ys)).toBe(100);
  });

  it('取数下标是 i * width + j —— 非方阵下越界的那些是 undefined，不是 0', () => {
    // i 最大 height-1 = 8，j 最大 width-1 = 9 ⇒ 最大下标 8*10+9 = 89，正好铺满。
    const points = buildBlobPoints(makeFrame(90), 10, 9, 100, 100);
    expect(points.every((p) => p.value !== undefined)).toBe(true);
    // 数据短一格就会出现 undefined，`groupByAlpha` 会把它归进 'NaN' 桶。
    const short = buildBlobPoints(makeFrame(89), 10, 9, 100, 100);
    expect(short[89].value).toBeUndefined();
  });
});

describe('groupByAlpha', () => {
  it('分桶与原实现一致', () => {
    const points = buildBlobPoints(makeFrame(1024), 32, 32, 648, 648);
    const expected = referenceGroup(points, 600);
    const actual = groupByAlpha(points, 600);

    expect(actual).toHaveLength(Object.keys(expected).length);
    actual.forEach((bucket) => {
      expect(expected[bucket.alpha]).toBeDefined();
      expect(bucket.points).toEqual(expected[bucket.alpha]);
    });
  });

  it('alpha 是 toFixed(2) 的字符串 —— 台阶 0.01，桶数上限 101', () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ x: 0, y: 0, value: i }));
    const buckets = groupByAlpha(points, 600);
    expect(buckets.length).toBeLessThanOrEqual(101);
    buckets.forEach((bucket) => {
      expect(bucket.alpha).toMatch(/^\d\.\d{2}$/);
    });
  });

  it('超过 max 的值统一夹到 1.00，不会溢出成多个桶', () => {
    const points = [600, 900, 1e6].map((value) => ({ x: 0, y: 0, value }));
    const buckets = groupByAlpha(points, 600);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].alpha).toBe('1.00');
    expect(buckets[0].points).toHaveLength(3);
  });

  it('undefined 归进 NaN 桶 —— 渲染器那句 isNaN 就是为它准备的', () => {
    const buckets = groupByAlpha([{ x: 0, y: 0, value: undefined }], 600);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].alpha).toBe('NaN');
    expect(Number.isNaN(Number(buckets[0].alpha))).toBe(true);
  });

  it('每个点都恰好落进一个桶，一个不丢一个不重', () => {
    const points = buildBlobPoints(makeFrame(1024), 32, 32, 648, 648);
    const total = groupByAlpha(points, 600)
      .reduce((sum, bucket) => sum + bucket.points.length, 0);
    expect(total).toBe(points.length);
  });

  it('保持插入顺序 —— 桶内点的先后与原点表一致', () => {
    const points = buildBlobPoints(makeFrame(1024), 32, 32, 648, 648);
    groupByAlpha(points, 600).forEach((bucket) => {
      const indexes = bucket.points.map((p) => points.indexOf(p));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    });
  });
});

describe('frameStats', () => {
  /** `client/src/page/home/Home.jsx` 那套读数的逐字内联。 */
  function referenceStats(arr) {
    const maxPres = arr.reduce((acc, item) => (acc > item ? acc : item), 0);
    const point = arr.filter((item) => item > 0).length;
    const totalPres = arr.reduce((sum, item) => sum + item, 0);
    const meanPres = (totalPres / (point === 0 ? 1 : point)).toFixed(2);
    return { meanPres, maxPres, point, totalPres };
  }

  it('与原读数逐字相同', () => {
    const frame = makeFrame(1024);
    expect(frameStats(frame)).toEqual(referenceStats(frame));
  });

  it('全零帧不除零', () => {
    expect(frameStats(new Array(64).fill(0)))
      .toEqual({ meanPres: '0.00', maxPres: 0, point: 0, totalPres: 0 });
  });

  it('非数组入参当空帧处理，不抛', () => {
    expect(frameStats(undefined).point).toBe(0);
    expect(frameStats(null).maxPres).toBe(0);
  });

  it('与 webglHeatmap 的同名函数结果一致（两份是有意的重复）', async () => {
    const { frameStats: webglFrameStats } = await import('../../webglHeatmap/core/pipeline.js');
    const frame = makeFrame(4096);
    expect(frameStats(frame)).toEqual(webglFrameStats(frame));
  });
});
