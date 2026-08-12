import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastFrame,
  getLastFrame,
  publishFrame,
  resetFrameBus,
  subscribeFrames,
} from './frameBus.js';

const FRAME = Object.freeze({ values: [1, 2, 3] });

beforeEach(() => {
  resetFrameBus();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('订阅与退订', () => {
  it('发布的帧原样送到订阅者手里', () => {
    const seen = [];
    subscribeFrames((frame) => seen.push(frame));
    publishFrame(FRAME);
    expect(seen).toEqual([FRAME]);
  });

  it('退订之后不再收到', () => {
    const seen = [];
    const unsubscribe = subscribeFrames((frame) => seen.push(frame));
    publishFrame(FRAME);
    unsubscribe();
    publishFrame({ values: [9] });
    expect(seen).toEqual([FRAME]);
  });

  it('重复退订不抛错', () => {
    const unsubscribe = subscribeFrames(() => {});
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('同一个函数订阅两次只算一份（Set 去重）', () => {
    const listener = vi.fn();
    subscribeFrames(listener);
    subscribeFrames(listener);
    publishFrame(FRAME);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('传非函数不注册，也不抛错', () => {
    expect(() => subscribeFrames(null)).not.toThrow();
    expect(publishFrame(FRAME)).toBe(0);
  });
});

describe('一个订阅者出错不影响其余', () => {
  it('中间那个抛了，前后两个照样收到', () => {
    // 这条是关键：一个渲染器画崩了，侧栏统计还得照常走。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = vi.fn();
    const after = vi.fn();
    subscribeFrames(before);
    subscribeFrames(() => { throw new Error('渲染器炸了'); });
    subscribeFrames(after);

    expect(() => publishFrame(FRAME)).not.toThrow();
    expect(before).toHaveBeenCalledWith(FRAME);
    expect(after).toHaveBeenCalledWith(FRAME);
    expect(publishFrame(FRAME)).toBe(2);
  });
});

describe('新订阅者补发最近一帧', () => {
  it('订阅时总线上已有帧就立刻同步补一次', () => {
    // 渲染器是懒加载的，挂载完成时数据流早就在跑了。不补发的话
    // 画面要空到下一帧才出来。
    publishFrame(FRAME);
    const listener = vi.fn();
    subscribeFrames(listener);
    expect(listener).toHaveBeenCalledWith(FRAME);
  });

  it('补发时抛错不影响订阅本身建立', () => {
    publishFrame(FRAME);
    let calls = 0;
    subscribeFrames(() => {
      calls += 1;
      if (calls === 1) throw new Error('首帧没准备好');
    });
    expect(() => publishFrame({ values: [7] })).not.toThrow();
    expect(calls).toBe(2);
  });

  it('还没有帧时不补发', () => {
    const listener = vi.fn();
    subscribeFrames(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearLastFrame 之后不再补发 —— 切换展示形式不该画上一台设备的数据', () => {
    publishFrame(FRAME);
    expect(getLastFrame()).toBe(FRAME);
    clearLastFrame();
    expect(getLastFrame()).toBeNull();

    const listener = vi.fn();
    subscribeFrames(listener);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('坏帧', () => {
  it('null / 非对象不发布，也不覆盖上一帧', () => {
    publishFrame(FRAME);
    const listener = vi.fn();
    subscribeFrames(listener);
    listener.mockClear();

    expect(publishFrame(null)).toBe(0);
    expect(publishFrame(undefined)).toBe(0);
    expect(publishFrame(42)).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(getLastFrame()).toBe(FRAME);
  });
});
