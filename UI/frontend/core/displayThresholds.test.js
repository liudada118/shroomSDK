/**
 * displayThresholds.test.js - 与被替换掉的 47 个模块级声明块等价
 *
 * 主张是「新实现 === 旧实现」，所以先把旧写法**逐字抄一遍**当基准（`legacyBlock`），
 * 再拿 `createThresholdState` 和它比。写法与 `sceneFrame.test.js`、`util.jet.test.js` 一致。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DUAL_CHANNEL_DEFAULTS,
  SECOND_CHANNEL_DEFAULTS,
  SINGLE_CHANNEL_DEFAULTS,
  STORAGE_KEYS,
  createThresholdState,
} from './displayThresholds.js';

/**
 * 逐字抄自 `three/hand.jsx:40-51` 的那 12 行（37 个文件里一字不差的同一份）。
 * 抄的时候不做任何顺手优化 —— 一改写，比的就不是等价性而是我对旧代码的理解了。
 */
function legacyDualBlock() {
  var valuej1 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 200,
    valueg1 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
    value1 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2,
    valuel1 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 2,
    valuef1 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
    valuej2 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 200,
    valueg2 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
    value2 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2,
    valuel2 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 2,
    valuef2 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
    valuelInit1 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2,
    valuelInit2 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2;
  return {
    valuej1, valueg1, value1, valuel1, valuef1, valuelInit1,
    valuej2, valueg2, value2, valuel2, valuef2, valuelInit2,
  };
}

/** 逐字抄自 `num/NumWs.jsx:6-11`（7 个单通道文件里的那一份）。 */
function legacySingleBlock() {
  var valuej1 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 200,
    valueg1 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
    value1 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2,
    valuel1 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 2,
    valuef1 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
    valuelInit1 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2;
  return { valuej1, valueg1, value1, valuel1, valuef1, valuelInit1 };
}

/** 逐字抄自 `three/wholeChair.jsx:123-134` —— 两通道默认值不对称的那一份。 */
function legacyWholeChairBlock() {
  var valuej1 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 255,
    valueg1 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 4,
    value1 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2.1,
    valuel1 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 1,
    valuef1 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
    valuej2 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 255,
    valueg2 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
    value2 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2,
    valuel2 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 2,
    valuef2 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
    valuelInit1 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2,
    valuelInit2 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2;
  return {
    valuej1, valueg1, value1, valuel1, valuef1, valuelInit1,
    valuej2, valueg2, value2, valuel2, valuef2, valuelInit2,
  };
}

/** `three/car10.jsx` 与 `three/Short.jsx` 的离群默认值，供覆盖式调用用。 */
const CAR10_DEFAULTS = {
  ...DUAL_CHANNEL_DEFAULTS,
  valuej1: 335, valueg1: 3.6, valuej2: 335, valueg2: 3.6,
  valuelInit1: 2000, valuelInit2: 2000,
};
const SHORT_DEFAULTS = {
  ...DUAL_CHANNEL_DEFAULTS,
  valuej1: 2655, valueg1: 3.3, value1: 2.08, valuel1: 4, valuef1: 0,
  valuelInit1: 2001,
};

/** 六个键的所有组合太多，取「全空 / 全设 / 部分设 / 边界值」四类。 */
const STORAGE_SCENARIOS = [
  ['localStorage 全空 —— 走各自的默认值', {}],
  ['六个键全部设了值', {
    carValuej: '480', carValueg: '3.5', carValue: '1.5',
    carValuel: '6', carValuef: '1', carValueInit: '900',
  }],
  ['只设了一部分（其余仍走默认值）', { carValuej: '300', carValueInit: '50' }],
  ['存了 0 —— `"0"` 是非空字符串故为真，老写法会取到 0 而不是默认值', {
    carValuej: '0', carValueg: '0', carValue: '0',
    carValuel: '0', carValuef: '0', carValueInit: '0',
  }],
  ['存了小数与负数', { carValuej: '12.75', carValueg: '-3' }],
  ['存了空字符串 —— 为假，回落默认值', { carValuej: '' }],
];

let store;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 把一组键值灌进 mock 的 localStorage。
 *
 * @param {Record<string, string>} entries 键值对。
 */
function seed(entries) {
  Object.entries(entries).forEach(([key, value]) => store.set(key, value));
}

describe('createThresholdState —— 与 37 份双通道声明块等价', () => {
  it.each(STORAGE_SCENARIOS)('%s', (_label, entries) => {
    seed(entries);
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS)).toEqual(legacyDualBlock());
  });

  it('返回的键与传进来的默认值键完全一致，一个不多一个不少', () => {
    seed({ carValuej: '480' });
    expect(Object.keys(createThresholdState(DUAL_CHANNEL_DEFAULTS)).sort())
      .toEqual(Object.keys(DUAL_CHANNEL_DEFAULTS).sort());
  });

  it('两个通道读的是同一个键，所以初值必然相同（默认值也相同时）', () => {
    seed({ carValuej: '777' });
    const state = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(state.valuej1).toBe(777);
    expect(state.valuej2).toBe(777);
  });

  it('返回的是新对象，不是共享引用 —— 两个消费文件互不干扰', () => {
    const a = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    const b = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(a).not.toBe(b);
    a.valuej1 = 999;
    expect(b.valuej1).toBe(200);
  });

  it('默认值对象本身不会被改写（冻结的）', () => {
    seed({ carValuej: '480' });
    createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(DUAL_CHANNEL_DEFAULTS.valuej1).toBe(200);
  });
});

describe('createThresholdState —— 与 7 份单通道声明块等价', () => {
  it.each(STORAGE_SCENARIOS)('%s', (_label, entries) => {
    seed(entries);
    expect(createThresholdState(SINGLE_CHANNEL_DEFAULTS)).toEqual(legacySingleBlock());
  });

  it('不会捎带出通道 2 的键', () => {
    expect(createThresholdState(SINGLE_CHANNEL_DEFAULTS)).not.toHaveProperty('valuej2');
  });
});

describe('createThresholdState —— 只有后缀 2 的那两个文件', () => {
  // `three/4096.jsx` / `three/NumThreeColor copy.jsx`：后缀 1 侧走共享的
  // `bed4096numParams`（切换模式时调参不重置），只有后缀 2 是本地声明。
  it.each(STORAGE_SCENARIOS)('与逐字抄来的后缀 2 声明块等价：%s', (_label, entries) => {
    seed(entries);
    const legacy = legacySingleBlock();
    expect(createThresholdState(SECOND_CHANNEL_DEFAULTS)).toEqual({
      valuej2: legacy.valuej1,
      valueg2: legacy.valueg1,
      value2: legacy.value1,
      valuel2: legacy.valuel1,
      valuef2: legacy.valuef1,
      valuelInit2: legacy.valuelInit1,
    });
  });

  it('不会捎带出通道 1 的键', () => {
    expect(createThresholdState(SECOND_CHANNEL_DEFAULTS)).not.toHaveProperty('valuej1');
  });
});

describe('三个离群文件的 per-file 默认值', () => {
  // 这一组是本步最容易踩的坑：默认值不统一，一刀切成 200 会静默改掉首屏表现。
  it.each(STORAGE_SCENARIOS)('wholeChair 两通道不对称的默认值：%s', (_label, entries) => {
    seed(entries);
    const defaults = {
      ...DUAL_CHANNEL_DEFAULTS,
      valuej1: 255, valueg1: 4, value1: 2.1, valuel1: 1, valuej2: 255,
    };
    expect(createThresholdState(defaults)).toEqual(legacyWholeChairBlock());
  });

  it('wholeChair 在 localStorage 全空时通道 1 与通道 2 的默认值确实不同', () => {
    const state = createThresholdState({
      ...DUAL_CHANNEL_DEFAULTS,
      valuej1: 255, valueg1: 4, value1: 2.1, valuel1: 1, valuej2: 255,
    });
    expect([state.valueg1, state.value1, state.valuel1]).toEqual([4, 2.1, 1]);
    expect([state.valueg2, state.value2, state.valuel2]).toEqual([2, 2, 2]);
  });

  it('car10：335 / 3.6 / valuelInit 2000', () => {
    expect(createThresholdState(CAR10_DEFAULTS)).toMatchObject({
      valuej1: 335, valueg1: 3.6, valuej2: 335, valueg2: 3.6,
      valuelInit1: 2000, valuelInit2: 2000,
    });
  });

  it('Short：通道 1 走 util.js initValue 那套，valuef1 的默认值是 0', () => {
    const state = createThresholdState(SHORT_DEFAULTS);
    expect(state).toMatchObject({
      valuej1: 2655, valueg1: 3.3, value1: 2.08, valuel1: 4, valuelInit1: 2001,
    });
    // 0 是个真实的默认值，不能被当成"没设"而回落到 2。
    expect(state.valuef1).toBe(0);
    expect(state.valuef2).toBe(2);
  });

  it('存了值时离群默认值让位于 localStorage', () => {
    seed({ carValuej: '111', carValueInit: '222' });
    expect(createThresholdState(CAR10_DEFAULTS)).toMatchObject({
      valuej1: 111, valuej2: 111, valuelInit1: 222, valuelInit2: 222,
    });
  });
});

describe('坏数据不再让页面打不开 —— 与老写法唯一的两处差异', () => {
  it('非 JSON 时回落默认值；老写法会在模块加载期抛异常', () => {
    seed({ carValuej: 'abc' });
    expect(() => legacyDualBlock()).toThrow();
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS).valuej1).toBe(200);
  });

  it('存成 "null" / "true" / 对象时回落默认值；老写法会把 null 当阈值用', () => {
    seed({ carValuej: 'null', carValueg: 'true', carValue: '{"a":1}' });
    expect(legacyDualBlock().valuej1).toBe(null);
    const state = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(state.valuej1).toBe(200);
    expect(state.valueg1).toBe(2);
    expect(state.value1).toBe(2);
  });

  it('Infinity / NaN 这类非有限值也回落', () => {
    seed({ carValuej: '1e999' });
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS).valuej1).toBe(200);
  });

  it('localStorage 本身抛异常（隐私模式 / 配额）时不炸', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
    });
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS)).toEqual({ ...DUAL_CHANNEL_DEFAULTS });
  });
});

describe('读取时机与键映射', () => {
  it('每次调用都现读 localStorage，不用模块级共享快照', () => {
    // 这条守着一个等价性要点：场景组件是懒加载的，今天每个文件在**自己**被加载时
    // 才读，所以「改了阈值再切到一个还没加载过的展示形式」会读到新值。若 store
    // 改成模块加载时读一次的共享快照，就会冻结在第一个消费者加载的时刻。
    const before = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(before.valuej1).toBe(200);
    seed({ carValuej: '480' });
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS).valuej1).toBe(480);
  });

  it('后缀 1 / 2 映射到同一个键，六个前缀的映射逐一对上', () => {
    expect(STORAGE_KEYS).toEqual({
      valuej: 'carValuej',
      valueg: 'carValueg',
      value: 'carValue',
      valuel: 'carValuel',
      valuef: 'carValuef',
      valuelInit: 'carValueInit',
    });
    seed({
      carValuej: '1', carValueg: '2', carValue: '3',
      carValuel: '4', carValuef: '5', carValueInit: '6',
    });
    expect(createThresholdState(DUAL_CHANNEL_DEFAULTS)).toEqual({
      valuej1: 1, valueg1: 2, value1: 3, valuel1: 4, valuef1: 5, valuelInit1: 6,
      valuej2: 1, valueg2: 2, value2: 3, valuel2: 4, valuef2: 5, valuelInit2: 6,
    });
  });

  it('`valuelInit` 不能被误当成 `valuel` + 后缀 —— 它有自己的键', () => {
    seed({ carValuel: '7', carValueInit: '900' });
    const state = createThresholdState(DUAL_CHANNEL_DEFAULTS);
    expect(state.valuel1).toBe(7);
    expect(state.valuelInit1).toBe(900);
  });

  it('变量名拼错时当场抛，不静默给 undefined', () => {
    expect(() => createThresholdState({ valuejj1: 200 })).toThrow(/valuejj1/);
  });
});
