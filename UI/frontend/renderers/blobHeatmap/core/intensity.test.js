/**
 * renderers/blobHeatmap/core/intensity.test.js
 *
 * `colorize` 是纯函数，直接与原实现差分。`createIntensity` 要一张画布，所以这里
 * **注入一个假的** —— 正是 `options.createCanvas` 那个注入点存在的理由（见
 * `intensity.js` 文件头「为什么它能进 core/」）。假画布只用来验证「调色板算一次
 * 就缓存」和「色标一条不落地喂给了 addColorStop」，不去复现浏览器的渐变插值。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  GRADIENT_STOPS,
  PALETTE_SIZE,
  colorize,
  createIntensity,
} from './intensity.js';

/* ── 原实现的逐字内联（canvas.jsx:201-242） ──────────────────────── */

function referenceColorize(pixels, gradient, options) {
  const max = options.max;
  const min = options.min;
  const diff = max - min;
  const range = options.range || null;

  let jMin = 0;
  let jMax = 1024;
  if (range && range.length === 2) {
    jMin = ((range[0] - min) / diff) * 1024;
    jMax = ((range[1] - min) / diff) * 1024;
  }

  const maxOpacity = options.maxOpacity || 0.9;

  for (let i = 3; i < pixels.length; i += 4) {
    const j = pixels[i] * 4;

    if (pixels[i] / 256 > maxOpacity) pixels[i] = 256 * maxOpacity;
    if (pixels[i] / 256 < 0.7) pixels[i] = 256 * 0.7;

    if (j && j >= jMin && j <= jMax) {
      pixels[i - 3] = gradient[j];
      pixels[i - 2] = gradient[j + 1];
      pixels[i - 1] = gradient[j + 2];
    } else {
      pixels[i] = 0;
    }
  }
}

/* ── 测试替身 ───────────────────────────────────────────────────── */

/** 一条确定性的 1024 字节"调色板"，值可预测，方便断言。 */
function fakePalette() {
  return Uint8ClampedArray.from({ length: PALETTE_SIZE * 4 }, (_, i) => (i * 7) % 256);
}

/** 一块确定性的像素，alpha 覆盖 0 / 低 / 中 / 高。 */
function fakePixels(count) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    pixels[i * 4] = 0;
    pixels[i * 4 + 1] = 0;
    pixels[i * 4 + 2] = 0;
    pixels[i * 4 + 3] = (i * 53) % 256;
  }
  return pixels;
}

/**
 * 一张够用的假画布。不模拟渐变插值 —— 只记下收到了哪些色标。
 *
 * @returns {{canvas: object, calls: object}} 画布与调用记录。
 */
function makeFakeCanvas() {
  const calls = { created: 0, stops: [], fills: 0, reads: 0 };
  const createCanvas = (width, height) => {
    calls.created += 1;
    return {
      width,
      height,
      getContext: () => ({
        createLinearGradient: () => ({
          addColorStop: (offset, color) => calls.stops.push([offset, color]),
        }),
        set fillStyle(_value) { /* 假画布不关心 */ },
        fillRect: () => { calls.fills += 1; },
        getImageData: () => {
          calls.reads += 1;
          return { data: fakePalette() };
        },
      }),
    };
  };
  return { createCanvas, calls };
}

/* ── 用例 ───────────────────────────────────────────────────────── */

describe('GRADIENT_STOPS', () => {
  it('六条色标，位置与颜色逐字等于原件', () => {
    expect(GRADIENT_STOPS).toEqual({
      0: 'rgba(21,18,42, 1)',
      0.40: 'rgba(62, 0, 248, 1)',
      0.55: 'rgba(149, 253, 237, 1)',
      0.70: 'rgba(154, 255, 62, 1)',
      0.85: 'rgba(246, 254, 71, 1)',
      1: 'rgba(216, 36, 36, 1)',
    });
  });

  it('位置落在 [0, 1] 且首尾齐全', () => {
    const keys = Object.keys(GRADIENT_STOPS).map(Number);
    expect(keys).toHaveLength(6);
    expect(Math.min(...keys)).toBe(0);
    expect(Math.max(...keys)).toBe(1);
    keys.forEach((key) => {
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThanOrEqual(1);
    });
  });

  it('⚠️ Object.keys 的顺序不是 0→1：整数式键 0 和 1 被排到了前面', () => {
    // 这一条不是在夸这个顺序，是在**钉住**它 —— 免得哪天有人看到
    // `addColorStop(1, 红)` 排在 `addColorStop(0.4, 蓝)` 前面，以为是 bug 去"修"。
    // `addColorStop` 按 offset 定位，与调用先后无关，所以画面不受影响。
    expect(Object.keys(GRADIENT_STOPS).map(Number))
      .toEqual([0, 1, 0.4, 0.55, 0.7, 0.85]);
  });
});

describe('createIntensity', () => {
  it('调色板只算一次 —— 原件每帧重算', () => {
    const { createCanvas, calls } = makeFakeCanvas();
    const intensity = createIntensity({ createCanvas });

    intensity.getImageData();
    intensity.getImageData();
    intensity.getImageData();

    expect(calls.created).toBe(1);
    expect(calls.fills).toBe(1);
    expect(calls.reads).toBe(1);
  });

  it('六条色标一条不落地喂给了 addColorStop（顺序按 Object.keys，见上）', () => {
    const { createCanvas, calls } = makeFakeCanvas();
    createIntensity({ createCanvas }).getImageData();

    expect(calls.stops).toEqual([
      [0, 'rgba(21,18,42, 1)'],
      [1, 'rgba(216, 36, 36, 1)'],
      [0.40, 'rgba(62, 0, 248, 1)'],
      [0.55, 'rgba(149, 253, 237, 1)'],
      [0.70, 'rgba(154, 255, 62, 1)'],
      [0.85, 'rgba(246, 254, 71, 1)'],
    ]);
  });

  it('画布尺寸是 256×1', () => {
    const created = [];
    const createCanvas = (width, height) => {
      created.push([width, height]);
      const { createCanvas: inner } = makeFakeCanvas();
      return inner(width, height);
    };
    createIntensity({ createCanvas }).getImageData();
    expect(created).toEqual([[PALETTE_SIZE, 1]]);
  });

  it('不带参数返回整条 1024 字节调色板', () => {
    const { createCanvas } = makeFakeCanvas();
    expect(createIntensity({ createCanvas }).getImageData())
      .toHaveLength(PALETTE_SIZE * 4);
  });

  it('自定义色标会替换默认那六条', () => {
    const { createCanvas, calls } = makeFakeCanvas();
    createIntensity({ createCanvas, gradient: { 0: 'red', 1: 'blue' } }).getImageData();
    expect(calls.stops).toEqual([[0, 'red'], [1, 'blue']]);
  });

  it('getSize 线性映射并把入参夹进 [min, max]', () => {
    const { createCanvas } = makeFakeCanvas();
    const intensity = createIntensity({
      createCanvas, min: 0, max: 100, minSize: 0, maxSize: 35,
    });
    expect(intensity.getSize(0)).toBe(0);
    expect(intensity.getSize(100)).toBe(35);
    expect(intensity.getSize(50)).toBe(17.5);
    expect(intensity.getSize(-999)).toBe(0);
    expect(intensity.getSize(1e9)).toBe(35);
  });

  it('四个 setter 改的是后续取值，不重算调色板', () => {
    const { createCanvas, calls } = makeFakeCanvas();
    const intensity = createIntensity({ createCanvas });
    intensity.getImageData();
    intensity.setMax(200);
    intensity.setMaxSize(70);
    expect(intensity.getSize(200)).toBe(70);
    expect(calls.created).toBe(1);
  });

  it('`||` 而不是 `??` 的原样保留：传 0 会退回默认值', () => {
    const { createCanvas } = makeFakeCanvas();
    const intensity = createIntensity({ createCanvas, max: 0, maxSize: 0 });
    // max 退回 100、maxSize 退回 35 —— 原件如此。
    expect(intensity.getSize(100)).toBe(35);
  });

  it('裸 Node 里 import 不炸，只有调用才要 DOM', () => {
    // 本文件已经 import 成功了；这里验证不注入工厂时才抛。
    expect(() => createIntensity().getImageData())
      .toThrow(/需要 DOM/);
  });

  it('gradient 挂在返回对象上，文档站的色卡直接读它', () => {
    const { createCanvas } = makeFakeCanvas();
    expect(createIntensity({ createCanvas }).gradient).toBe(GRADIENT_STOPS);
  });
});

describe('colorize', () => {
  it('与原实现逐字节相同（默认 maxOpacity）', () => {
    const gradient = fakePalette();
    const mine = fakePixels(500);
    const theirs = fakePixels(500);

    colorize(mine, gradient, { max: 600, min: 0 });
    referenceColorize(theirs, gradient, { max: 600, min: 0 });

    expect(Array.from(mine)).toEqual(Array.from(theirs));
  });

  it('与原实现逐字节相同（maxOpacity 0.5）', () => {
    const gradient = fakePalette();
    const mine = fakePixels(500);
    const theirs = fakePixels(500);

    colorize(mine, gradient, { max: 600, min: 0, maxOpacity: 0.5 });
    referenceColorize(theirs, gradient, { max: 600, min: 0, maxOpacity: 0.5 });

    expect(Array.from(mine)).toEqual(Array.from(theirs));
  });

  it('alphaFloor 不传就是原件那个写死的 0.7', () => {
    const gradient = fakePalette();
    const mine = fakePixels(500);
    const theirs = fakePixels(500);

    colorize(mine, gradient, { max: 600, min: 0, alphaFloor: 0.7 });
    referenceColorize(theirs, gradient, { max: 600, min: 0 });

    expect(Array.from(mine)).toEqual(Array.from(theirs));
  });

  it('alphaFloor 放到 0 之后淡色区才真的淡下来', () => {
    const gradient = fakePalette();
    const floored = fakePixels(500);
    const free = fakePixels(500);

    colorize(floored, gradient, { max: 600, min: 0 });
    colorize(free, gradient, { max: 600, min: 0, alphaFloor: 0 });

    // 默认那份最低 alpha 是 0.7*256 取整；放开之后能出现更低的非零值。
    const alphasOf = (px) => Array.from(px).filter((_, i) => i % 4 === 3).filter((a) => a > 0);
    expect(Math.min(...alphasOf(floored))).toBeGreaterThanOrEqual(179);
    expect(Math.min(...alphasOf(free))).toBeLessThan(179);
  });

  it('alpha 为 0 的像素走 else 分支被清成全透明', () => {
    const gradient = fakePalette();
    const pixels = new Uint8ClampedArray([9, 9, 9, 0]);
    colorize(pixels, gradient, { max: 600, min: 0, alphaFloor: 0 });
    expect(pixels[3]).toBe(0);
    // RGB 没被改 —— else 分支只碰 alpha。
    expect(Array.from(pixels.slice(0, 3))).toEqual([9, 9, 9]);
  });

  it('⚠️ 默认 alphaFloor 也照样走 else —— `j` 是用夹之前的 alpha 算的', () => {
    // 这条纠正了一个想当然的推断：「0.7 已经把 alpha 抬上去了，所以 else 进不去」。
    // 其实 `j = pixels[i] * 4` 在两条 if **上面**，alpha 原本为 0 的像素 j 就是 0，
    // 落进 else 又被设回 0。热区之外每一个像素都走这条路 —— 这正是背景保持透明、
    // 能透出渲染器铺的 #666 的机制。
    const gradient = fakePalette();
    const pixels = new Uint8ClampedArray([9, 9, 9, 0]);
    colorize(pixels, gradient, { max: 600, min: 0 });
    expect(pixels[3]).toBe(0);
    expect(Array.from(pixels.slice(0, 3))).toEqual([9, 9, 9]);
  });

  it('全透明的一整片进出都是全透明 —— 空帧不会被染成底色', () => {
    const gradient = fakePalette();
    const pixels = new Uint8ClampedArray(400 * 4); // 全 0
    colorize(pixels, gradient, { max: 600, min: 0 });
    expect(Array.from(pixels).every((byte) => byte === 0)).toBe(true);
  });

  it('查表下标是**夹之前**的 alpha —— 原件的顺序，别顺手调', () => {
    const gradient = fakePalette();
    const pixels = new Uint8ClampedArray([0, 0, 0, 10]);
    colorize(pixels, gradient, { max: 600, min: 0 });
    // j = 10 * 4 = 40，取的是 gradient[40..42]，与夹到 179 无关。
    expect(Array.from(pixels.slice(0, 3)))
      .toEqual([gradient[40], gradient[41], gradient[42]]);
  });

  it('range 那两支原件永远走不到，但传进来能生效', () => {
    const gradient = fakePalette();
    const pixels = new Uint8ClampedArray([0, 0, 0, 255]);
    // j = 1020，窗口只开到 100 ⇒ 落进 else 被清成透明。
    colorize(pixels, gradient, { max: 600, min: 0, range: [0, 60] });
    expect(pixels[3]).toBe(0);
  });

  it('就地改入参，不返回新数组', () => {
    const gradient = fakePalette();
    const pixels = fakePixels(4);
    expect(colorize(pixels, gradient, { max: 600, min: 0 })).toBeUndefined();
  });

  it('原件那句 `const value = jet()` 删了 —— 不再有零参调用', () => {
    // 用 spy 兜住：`colorize` 内部不该调用任何外部函数。
    const gradient = fakePalette();
    const spy = vi.spyOn(Math, 'min');
    colorize(fakePixels(4), gradient, { max: 600, min: 0 });
    // 循环体里没有 Math.min —— 夹值是两条 if。
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
