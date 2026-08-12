import { describe, expect, it } from 'vitest';
import { SCENE_CHANNELS, buildSceneFrame, padThumbGap, toRaw256 } from './sceneFrame.js';

/**
 * 这份测试的主张是「新路径输出 === 旧路径输出」。
 *
 * 所以每一组都先把 Home.jsx 里那段内联代码**逐字抄一遍**当作基准，
 * 再拿新函数的结果和它比。抄的时候不做任何顺手优化 —— 一旦改写，
 * 比的就不是等价性而是我对旧代码的理解了。
 */

/** 造一份长度可控、值不重复的数据，避免下标错位时碰巧相等。 */
const makeValues = (length) => Array.from({ length }, (_, i) => i + 1);

describe('拇指位补零 padThumbGap', () => {
  /** Home.jsx:2607-2609 原样搬来的基准实现。 */
  const legacyPad = (values) => {
    const newArr = [...values];
    newArr.splice(5 * 15, 0, 0);
    newArr.splice(5 * 15, 0, 0);
    newArr.splice(5 * 15, 0, 0);
    return newArr;
  };

  it('和三次 splice 的结果逐点相等', () => {
    const values = makeValues(150);
    expect(padThumbGap(values)).toEqual(legacyPad(values));
  });

  it('短于插入下标时也和旧实现一致（splice 会追加到末尾）', () => {
    const values = makeValues(10);
    expect(padThumbGap(values)).toEqual(legacyPad(values));
    expect(padThumbGap(values)).toEqual([...values, 0, 0, 0]);
  });

  it('空数组也一致', () => {
    expect(padThumbGap([])).toEqual(legacyPad([]));
  });

  it('长度恰好加 3，且三个 0 落在下标 75', () => {
    const padded = padThumbGap(makeValues(150));
    expect(padded).toHaveLength(153);
    expect(padded.slice(74, 79)).toEqual([75, 0, 0, 0, 76]);
  });

  it('不改入参 —— 这是对旧实现的一处**有意**修正', () => {
    // 旧代码原地改 newArr，而 newArr 在此之前已经作为 hand 通道推给渲染器了。
    // 渲染器只要留了引用，就会读到补零之后的数据。这里返回新数组。
    const values = makeValues(150);
    const snapshot = [...values];
    padThumbGap(values);
    expect(values).toEqual(snapshot);
  });

  it('非数组返回空数组，不抛错', () => {
    expect(padThumbGap(null)).toEqual([]);
    expect(padThumbGap(undefined)).toEqual([]);
    expect(padThumbGap('nope')).toEqual([]);
  });
});

describe('原始矩阵 toRaw256', () => {
  /** Home.jsx:2200-2210 原样搬来的基准实现。 */
  const legacyRaw = (rawPayload, wsPointData) => {
    let rawData = rawPayload;
    if (rawData && !Array.isArray(rawData)) {
      rawData = JSON.parse(rawData);
    }
    if (rawData && rawData.length >= 256) {
      return [...rawData.slice(0, 256)];
    }
    return [...wsPointData];
  };

  it('够 256 时切前 256 个，和旧实现一致', () => {
    const raw = makeValues(300);
    const values = makeValues(147);
    expect(toRaw256(raw, values)).toEqual(legacyRaw(raw, values));
    expect(toRaw256(raw, values)).toHaveLength(256);
  });

  it('恰好 256 时整份取走', () => {
    const raw = makeValues(256);
    expect(toRaw256(raw, [])).toEqual(raw);
  });

  it('不足 256 时回落到映射数据，而不是画空白', () => {
    const raw = makeValues(100);
    const values = makeValues(147);
    expect(toRaw256(raw, values)).toEqual(legacyRaw(raw, values));
    expect(toRaw256(raw, values)).toEqual(values);
  });

  it('JSON 字符串先解析再判长度，和旧实现一致', () => {
    const raw = JSON.stringify(makeValues(300));
    const values = makeValues(147);
    expect(toRaw256(raw, values)).toEqual(legacyRaw(raw, values));
  });

  it('解析不出来时回落 —— 旧实现在这里会抛，是有意收紧', () => {
    // 旧代码的 JSON.parse 没有 try/catch，一帧坏数据会打断整个 onmessage。
    const values = makeValues(147);
    expect(() => legacyRaw('{坏数据', values)).toThrow();
    expect(toRaw256('{坏数据', values)).toEqual(values);
  });

  it('没有 raw 时回落，回落数据也缺失时给空数组', () => {
    expect(toRaw256(null, makeValues(5))).toEqual([1, 2, 3, 4, 5]);
    expect(toRaw256(null, null)).toEqual([]);
  });

  it('返回的是副本，改它不会污染入参', () => {
    const raw = makeValues(300);
    toRaw256(raw, [])[0] = 999;
    expect(raw[0]).toBe(1);
  });
});

describe('组装规范帧 buildSceneFrame', () => {
  it('最小帧只有 sit 一条通道', () => {
    const values = makeValues(147);
    const frame = buildSceneFrame({ values });
    expect(frame.values).toEqual(values);
    expect(frame.raw).toBeNull();
    expect(Object.keys(frame.channels)).toEqual([SCENE_CHANNELS.SIT]);
  });

  it('给了 rawPayload 才有 raw 通道 —— 用不上的通道不每帧分配', () => {
    expect(buildSceneFrame({ values: makeValues(10) }).channels.raw).toBeUndefined();
    const frame = buildSceneFrame({ values: makeValues(10), rawPayload: makeValues(300) });
    expect(frame.channels.raw).toHaveLength(256);
    expect(frame.raw).toBe(frame.channels.raw);
  });

  it('side 决定左右手通道，不给就不分', () => {
    const values = makeValues(147);
    expect(buildSceneFrame({ values, side: 'left' }).channels.left).toEqual(values);
    expect(buildSceneFrame({ values, side: 'left' }).channels.right).toBeUndefined();
    expect(buildSceneFrame({ values, side: 'right' }).channels.right).toEqual(values);
    expect(buildSceneFrame({ values, side: 'nonsense' }).channels.nonsense).toBeUndefined();
  });

  it('showType 为 palm / finger 时补零，为 hand 时不补', () => {
    // 旧代码里 hand 通道拿的是 splice 之前那份，palm/finger 拿的是之后那份。
    const values = makeValues(150);
    expect(buildSceneFrame({ values, showType: 'hand' }).channels.palm).toBeUndefined();
    expect(buildSceneFrame({ values, showType: 'hand' }).channels.sit).toEqual(values);
    expect(buildSceneFrame({ values, showType: 'palm' }).channels.palm).toEqual(padThumbGap(values));
    expect(buildSceneFrame({ values, showType: 'finger' }).channels.finger).toEqual(padThumbGap(values));
  });

  it('sit 通道始终是未补零的那份', () => {
    const values = makeValues(150);
    const frame = buildSceneFrame({ values, showType: 'finger' });
    expect(frame.channels.sit).toEqual(values);
    expect(frame.channels.finger).toHaveLength(153);
  });

  it('width 和 meta 原样带上，供侧栏统计和调试用', () => {
    const frame = buildSceneFrame({
      values: makeValues(4),
      width: 16,
      meta: { matrixName: 'hand0205', numMatrixFlag: 'normal', local: true },
    });
    expect(frame.width).toBe(16);
    expect(frame.meta).toEqual({ matrixName: 'hand0205', numMatrixFlag: 'normal', local: true });
  });

  it('空入参不抛错，给一帧结构完整的空帧', () => {
    expect(() => buildSceneFrame()).not.toThrow();
    const frame = buildSceneFrame();
    expect(frame.values).toEqual([]);
    expect(frame.channels.sit).toEqual([]);
    expect(frame.meta).toEqual({});
  });

  it('values 不是数组时当空帧处理', () => {
    expect(buildSceneFrame({ values: null }).values).toEqual([]);
    expect(buildSceneFrame({ values: 'nope' }).channels.sit).toEqual([]);
  });
});

describe('旧的四段 numMatrixFlag 分支收敛成同一条 sit 通道', () => {
  it('numoriginal / num3D / num / 其它 num 前缀 —— 旧代码都是 [...wsPointData]', () => {
    // Home.jsx:2186、2212、2220 三段的实现完全相同（`let newArr = [...wsPointData]`
    // 再推 changeWsData147R || changeWsData147），区别只有注释。
    // 2194 那段（'num'）才真的不同：它走 256 原始数据。
    const values = makeValues(147);
    const sameShape = ['numoriginal', 'num3D', 'numAnythingElse'];
    sameShape.forEach((numMatrixFlag) => {
      const frame = buildSceneFrame({ values, meta: { numMatrixFlag } });
      expect(frame.channels.sit).toEqual([...values]);
      expect(frame.channels.raw).toBeUndefined();
    });

    const numFrame = buildSceneFrame({
      values,
      rawPayload: makeValues(300),
      meta: { numMatrixFlag: 'num' },
    });
    expect(numFrame.channels.raw).toHaveLength(256);
  });
});
