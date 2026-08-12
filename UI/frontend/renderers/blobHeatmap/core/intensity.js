/**
 * renderers/blobHeatmap/core/intensity.js - 斑点热力（Canvas 2D）的调色板
 *
 * 搬自 `client/src/components/heatmap/canvas.jsx:267-404` 的 `Intensity`
 * 构造函数。原件把这 138 行**定义在 `forwardRef` 的函数体里** —— 组件每渲染一次
 * 就重建一遍构造函数和它的六个原型方法，`draw()` 里每帧还 `new Intensity()` 一个，
 * 于是每帧新建一张 256×1 的离屏画布、画一遍线性渐变、再 `getImageData` 读回来。
 * 提到这一层之后调色板只算一次，`getImageData` 的结果也缓存了。
 *
 * ## 为什么它能进 `core/`
 *
 * 严格说它**碰 DOM**（`document.createElement('canvas')` + 2D 上下文），按分层
 * 规矩该在 `react/`。但它的对外面是纯的：给一组色标，要一条 256 级的调色板。
 * 所以这里的做法是**把画布注入进来**：`createIntensity({ createCanvas })`。
 * 默认实现用 `document`，裸 Node 里传一个假的就能测 —— `core/` 那条"能在裸 Node
 * 里 import"的红线因此没破（import 本文件不碰 `document`，只有调用才碰）。
 *
 * 顺带把 `GRADIENT_STOPS` 单独导出：文档站的色卡直接读它，不用起一个画布。
 */

/**
 * 原件那六个色标，逐字搬。
 *
 * 键是 0~1 的位置，值是 `createLinearGradient` 认的颜色串。**不转成 rgb 三元组**
 * 是刻意的：这条色带是 Canvas 的 `addColorStop` 插的，插值发生在浏览器里；换成
 * 我们自己算就要复现一遍它的插值规则（含 premultiplied alpha），没有收益。
 *
 * 原件里还有三条注释掉的色标（`0: 白`、`0.05`、`0.28`），一起搬过来放在注释里，
 * 免得下次有人以为色带只有六段。
 *
 * ⚠️ **`Object.keys` 出来的顺序不是 0 → 1。** `0` 和 `1` 是整数式键，JS 把它们排在
 * 所有字符串键之前，于是实际顺序是 `0, 1, 0.4, 0.55, 0.7, 0.85` —— `addColorStop`
 * 收到的第二条就是终点色。这不影响画面（`addColorStop` 按 offset 定位，与调用先后
 * 无关），也是原件一直以来的行为，所以照抄；写在这里是因为它看着像 bug。
 */
export const GRADIENT_STOPS = {
  0: 'rgba(21,18,42, 1)',
  // 0: "rgba(255, 255, 255, 1)",
  // 0.05: "rgba(90, 0, 255, 1)",
  // 0.28: "rgba(0, 0, 255, 1)",
  0.40: 'rgba(62, 0, 248, 1)',
  0.55: 'rgba(149, 253, 237, 1)',
  0.70: 'rgba(154, 255, 62, 1)',
  0.85: 'rgba(246, 254, 71, 1)',
  1: 'rgba(216, 36, 36, 1)',
};

/** 调色板的级数。原件写死 256，`colorize` 里那个 `pixels[i] * 4` 依赖它。 */
export const PALETTE_SIZE = 256;

const DEFAULTS = {
  maxSize: 35,
  minSize: 0,
  max: 100,
  min: 0,
};

/**
 * 默认的离屏画布工厂。
 *
 * @param {number} width 宽。
 * @param {number} height 高。
 * @returns {HTMLCanvasElement} 画布。
 * @throws {Error} 没有 `document` 时。
 */
function domCanvas(width, height) {
  if (typeof document === 'undefined') {
    throw new Error('[blobHeatmap] 需要 DOM：调色板要一张离屏画布');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * 造一条调色板。
 *
 * 对外面与原件的 `new Intensity(options)` 一一对应，只是换成了工厂函数
 * （原件是构造函数 + 六个 `prototype` 方法），并且**调色板只算一次**。
 *
 * @param {object} [options] 选项。
 * @param {object} [options.gradient] 色标表，默认 `GRADIENT_STOPS`。
 * @param {number} [options.max=100] 取色/取尺寸的上界。
 * @param {number} [options.min=0] 下界。
 * @param {number} [options.maxSize=35] `getSize` 的上界。
 * @param {number} [options.minSize=0] `getSize` 的下界。
 * @param {(w: number, h: number) => HTMLCanvasElement} [options.createCanvas]
 *   画布工厂，测试可注入。
 * @returns {{getImageData: Function, getSize: Function, getLegend: Function,
 *   setMax: Function, setMin: Function, setMaxSize: Function,
 *   setMinSize: Function, gradient: object}} 调色板。
 */
export function createIntensity(options = {}) {
  const gradient = options.gradient || GRADIENT_STOPS;
  const createCanvas = options.createCanvas || domCanvas;

  const state = {
    // ⚠️ `||` 而不是 `??` —— 原件如此，所以传 `max: 0` 会退回 100、传
    // `minSize: 0` 会退回 0（同值，看不出来）。照抄，不"顺手修正"。
    max: options.max || DEFAULTS.max,
    min: options.min || DEFAULTS.min,
    maxSize: options.maxSize || DEFAULTS.maxSize,
    minSize: options.minSize || DEFAULTS.minSize,
  };

  /** 256×1 的调色板像素，算一次就存下来（原件每次 `getImageData` 都重读）。 */
  let palette = null;

  function ensurePalette() {
    if (palette) return palette;
    const canvas = createCanvas(PALETTE_SIZE, 1);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const lineGradient = ctx.createLinearGradient(0, 0, PALETTE_SIZE, 1);
    Object.keys(gradient).forEach((key) => {
      lineGradient.addColorStop(parseFloat(key), gradient[key]);
    });
    ctx.fillStyle = lineGradient;
    ctx.fillRect(0, 0, PALETTE_SIZE, 1);
    palette = ctx.getImageData(0, 0, PALETTE_SIZE, 1).data;
    return palette;
  }

  return {
    gradient,

    /**
     * 不给 `value` 就返回整条调色板（`colorize` 就是这么用的），给了就返回那一格
     * 的 RGBA 四元组。
     *
     * ⚠️ 取单格那一支有个**原件就有的越界**：`index` 是按 256 级算的，却直接拿去
     * 索引长度 1024 的 `data`（`imageData[index]`、`index + 1` …）—— 也就是说它取
     * 到的根本不是 `value` 对应的颜色，而是前 64 格里的某几个字节。照抄，因为
     * **这一支全仓零调用**（`colorize` 只用不带参数的那一支），修它等于改一个没人
     * 走的分支。
     *
     * @param {number} [value] 值。
     * @returns {Uint8ClampedArray | number[]} 整条调色板或一个 RGBA 四元组。
     */
    getImageData(value) {
      const data = ensurePalette();
      if (value === undefined) return data;
      const clamped = Math.min(state.max, Math.max(state.min, value));
      const index = Math.floor(
        ((clamped - state.min) / (state.max - state.min)) * (PALETTE_SIZE - 1),
      );
      return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    },

    /**
     * 值 → 尺寸的线性映射。**全仓零调用**，搬过来是为了对外面完整。
     *
     * @param {number} value 值。
     * @returns {number} 尺寸。
     */
    getSize(value) {
      const clamped = Math.min(state.max, Math.max(state.min, value));
      return state.minSize
        + ((clamped - state.min) / (state.max - state.min)) * (state.maxSize - state.minSize);
    },

    /**
     * 画一张竖着的图例。**全仓零调用**，同上。
     *
     * @param {{width?: number, height?: number}} [legendOptions] 尺寸。
     * @returns {HTMLCanvasElement} 图例画布。
     */
    getLegend(legendOptions = {}) {
      const width = legendOptions.width || 20;
      const height = legendOptions.height || 180;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const lineGradient = ctx.createLinearGradient(0, height, 0, 0);
      Object.keys(gradient).forEach((key) => {
        lineGradient.addColorStop(parseFloat(key), gradient[key]);
      });
      ctx.fillStyle = lineGradient;
      ctx.fillRect(0, 0, width, height);
      return canvas;
    },

    setMax(value) { state.max = value || DEFAULTS.max; },
    setMin(value) { state.min = value || DEFAULTS.min; },
    setMaxSize(value) { state.maxSize = value || DEFAULTS.maxSize; },
    setMinSize(value) { state.minSize = value || DEFAULTS.minSize; },
  };
}

/**
 * 把一整块 `ImageData.data` 按 alpha 查调色板着色。**就地改 `pixels`**。
 *
 * 逐字搬自 `canvas.jsx:201-242` 的 `colorize`，包括三处怪东西：
 *
 * 1. **alpha 被夹进 `[0.7, maxOpacity]`** —— 也就是说画面上没有真正的淡色区，
 *    最淡也有 0.7。这是这张图"整体发糊"的来源，但它就是现在的样子。下界放出来成了
 *    `options.alphaFloor`，默认仍是 0.7，不传就是原行为。
 * 2. **`j` 是用夹之前的 alpha 算的**（`j = pixels[i] * 4` 在两条 `if` **上面**），
 *    所以 alpha 原本为 0 的像素 `j === 0` 走 else，被重新设回 0 —— **那条 else 是
 *    热区之外每一个像素都要走的路，不是死分支**。这正是热区外保持全透明、能透出
 *    渲染器铺的底色 `#666` 的机制。取色下标也因此是"夹之前"的 alpha。顺序照抄，
 *    别顺手把 `j` 挪到 `if` 下面去 —— 那会让整张图的底色变成色带第 179 格。
 * 3. 原件在循环里还有一句 `const value = jet()` —— **无参空调用，结果没人接**，
 *    每个像素调一次。删掉了，`jet` 的实现不接受零参数，返回值也没被读。
 *
 * `range` 那两支（`jMin` / `jMax`）原件永远走不到：`options.range` 从没被赋过值。
 * 照抄保留，因为它是这个函数唯一的可配置点。
 *
 * @param {Uint8ClampedArray} pixels `getImageData().data`。
 * @param {Uint8ClampedArray} gradient 256 级调色板（`getImageData()` 不带参数）。
 * @param {{max: number, min: number, range?: [number, number],
 *   maxOpacity?: number, alphaFloor?: number}} options 配置。
 * @returns {void}
 */
export function colorize(pixels, gradient, options) {
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
  const alphaFloor = options.alphaFloor != null ? options.alphaFloor : 0.7;

  for (let i = 3; i < pixels.length; i += 4) {
    const j = pixels[i] * 4;

    if (pixels[i] / 256 > maxOpacity) pixels[i] = 256 * maxOpacity;
    if (pixels[i] / 256 < alphaFloor) pixels[i] = 256 * alphaFloor;

    if (j && j >= jMin && j <= jMax) {
      pixels[i - 3] = gradient[j];
      pixels[i - 2] = gradient[j + 1];
      pixels[i - 1] = gradient[j + 2];
    } else {
      pixels[i] = 0;
    }
  }
}

export default createIntensity;
