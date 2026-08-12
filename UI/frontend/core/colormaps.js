/**
 * 压力图配色方案。
 *
 * 引入之前颜色写死在 ManifestDisplayRenderer 的两处（矩阵格背景和坐标点填充），
 * 公式是 `hsl(195 - ratio * 195, 88%, 42% + ratio * 8%)`。这里把它登记成
 * `classic` 并逐字复刻，保证既有展示系统换用本模块后观感零变化；其余方案按
 * 色标插值。sample 返回 CSS 颜色字符串，SVG fill 和 DOM background 都能直接用。
 */

// 走 jetLadder.js 而不是 util.js：本文件会被后端测试用裸 Node ESM 加载
// （backend/tests/sdk/displayProfileRuntime.test.js），import 不了 util.js
// —— 它内部的导入没写扩展名，且顶层就在读 localStorage。详见 jetLadder.js 头部。
import { JET_LADDER_SEGMENTS, jetRgb } from './jetLadder.js';

const CLASSIC_ID = 'classic';

/**
 * 把 ratio 夹到 [0, 1]，非有限值按 0 处理。
 *
 * @param {number} ratio 归一化比例。
 * @returns {number} 合法比例。
 */
function clampRatio(ratio) {
  const numeric = Number(ratio);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

/**
 * 在色标数组上做线性插值。
 *
 * @param {Array<[number, number, number]>} stops RGB 色标，等距分布。
 * @param {number} ratio 归一化比例。
 * @returns {[number, number, number]} 0-255 的 RGB 三元组。
 */
function interpolateStops(stops, ratio) {
  const position = clampRatio(ratio) * (stops.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(stops.length - 1, lowerIndex + 1);
  const weight = position - lowerIndex;
  const lower = stops[lowerIndex];
  const upper = stops[upperIndex];
  const channel = (index) => Math.round(lower[index] + (upper[index] - lower[index]) * weight);
  return [channel(0), channel(1), channel(2)];
}

function buildPreviewCss(sample) {
  const steps = Array.from({ length: 6 }, (_, index) => sample(index / 5));
  return `linear-gradient(90deg, ${steps.join(', ')})`;
}

function createStopColormap(id, label, stops) {
  const sampleRgb = (ratio) => interpolateStops(stops, ratio);
  const sample = (ratio) => {
    const [red, green, blue] = sampleRgb(ratio);
    return `rgb(${red} ${green} ${blue})`;
  };
  return { id, label, sample, sampleRgb, previewCss: buildPreviewCss(sample) };
}

/**
 * classic 的采样函数就是引入本模块之前的硬编码公式，不要改动它的数值。
 */
function sampleClassic(ratio) {
  const safeRatio = clampRatio(ratio);
  const hue = 195 - safeRatio * 195;
  return `hsl(${hue} 88% ${42 + safeRatio * 8}%)`;
}

/**
 * classic 的数值形式。CSS 侧必须继续输出上面那条 hsl 字符串（有断言守着），
 * 所以这里单独把同一组 HSL 参数换算成 RGB，供 WebGL / Canvas 之类只认数值的地方用。
 *
 * @param {number} ratio 归一化比例。
 * @returns {[number, number, number]} 0-255 的 RGB 三元组。
 */
function sampleClassicRgb(ratio) {
  const safeRatio = clampRatio(ratio);
  const hue = (195 - safeRatio * 195) / 360;
  const lightness = (42 + safeRatio * 8) / 100;
  const saturation = 0.88;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue * 6;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = lightness - chroma / 2;
  const table = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  const [red, green, blue] = table[Math.min(5, Math.floor(sector))];
  return [
    Math.round((red + base) * 255),
    Math.round((green + base) * 255),
    Math.round((blue + base) * 255),
  ];
}

/**
 * jet 的数值形式。走 `assets/util/util.js` 的 `jetRgb`，也就是全仓那条唯一的
 * 分支阶梯 —— 老场景组件的 `jet()` 出口同样挂在它下面，两处不会漂移。
 *
 * **这里用 `Math.round`，不是老场景那个 `parseInt`。** `jet()` 的取整是
 * `parseInt(255 * r + '')`，撞上科学计数法会出错（`parseInt('7.1e-12') === 7`，
 * 详见 `util.jet.test.js` 里那条锁 bug 的断言）。配色栏是新通路，没有观感要保，
 * 所以从一开始就用正确的取整；差异只在段界附近的 1/255，肉眼无别。
 *
 * @param {number} ratio 归一化比例。
 * @returns {[number, number, number]} 0-255 的 RGB 三元组。
 */
function sampleJetRgb(ratio) {
  const { r, g, b } = jetRgb(0, 1, clampRatio(ratio));
  return [Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)];
}

/**
 * jet 的 CSS 形式。写法与 `createStopColormap` 一致（空格分隔的 `rgb()`），
 * 让「数值通路与 CSS 通路同色」那条断言能逐字比对。
 *
 * @param {number} ratio 归一化比例。
 * @returns {string} CSS 颜色字符串。
 */
function sampleJet(ratio) {
  const [red, green, blue] = sampleJetRgb(ratio);
  return `rgb(${red} ${green} ${blue})`;
}

/**
 * 斑点热力（`webglHeatmap`）那条 8 段色带，逐字来自
 * `components/webgl/WebGL.HeatMap copy 2.js` 的 `fragmentShader1`。
 *
 * **它和上面六条的区别是色标不等距**：0.14 一档走到 0.84，最后一段却是 0.16 宽。
 * `createStopColormap` 假定等距，所以这条走 `createPositionedStopColormap`。
 *
 * ⚠️ **`c7` 的注释与代码不符，照代码搬。** 原件写的是
 * `const vec3 c7 = vec3(1.0, 0.0, 0.0); /* 1.00 -> #FF1E42 *\/` —— 注释说
 * `#FF1E42`（一个偏粉的红），代码是纯红，和 `c6` 一模一样。也就是最后那 16%
 * 是一段**恒定色**，`mix(c6, c7, t)` 是个空插值。搬家不改观感，所以这里照代码
 * 记 `[255, 0, 0]`；要改成注释里那个颜色是一次看得见的画面变化，另议。
 */
export const HEAT_BLOB_STOPS = [
  { at: 0.00, rgb: [0, 0, 0] },       // #000000
  { at: 0.14, rgb: [0, 0, 255] },     // #0000FF
  { at: 0.28, rgb: [0, 102, 255] },   // #0066FF（GLSL 写作 0.4，102/255 正好是 0.4）
  { at: 0.42, rgb: [0, 255, 0] },     // #00FF00
  { at: 0.56, rgb: [255, 255, 0] },   // #FFFF00
  { at: 0.70, rgb: [255, 102, 0] },   // #FF6600
  { at: 0.84, rgb: [255, 0, 0] },     // #FF0000
  { at: 1.00, rgb: [255, 0, 0] },     // 注释写 #FF1E42，代码是纯红 —— 见上
];

/**
 * 在**不等距**色标上插值，返回未取整的 0-255 浮点三元组。
 *
 * 不取整是有意的：`heatBlobs` 还要在插值结果上做一次 gamma，先取整会把误差
 * 放大到肉眼可见（暗端尤其明显，`pow` 在 0 附近很陡）。
 *
 * @param {Array<{at: number, rgb: [number, number, number]}>} stops 升序色标。
 * @param {number} ratio 归一化比例。
 * @returns {[number, number, number]} 0-255 的浮点 RGB。
 */
function interpolatePositionedStops(stops, ratio) {
  const position = clampRatio(ratio);
  for (let index = 0; index < stops.length - 1; index += 1) {
    const upper = stops[index + 1];
    if (position <= upper.at) {
      const lower = stops[index];
      const span = upper.at - lower.at;
      const weight = span > 0 ? (position - lower.at) / span : 0;
      const channel = (i) => lower.rgb[i] + (upper.rgb[i] - lower.rgb[i]) * weight;
      return [channel(0), channel(1), channel(2)];
    }
  }
  return [...stops[stops.length - 1].rgb];
}

/**
 * `heatBlobs` 的数值形式：插值之后再跑一遍着色器里那句 `linearToSRGB`。
 *
 * **gamma 必须在这里跑，不能只留在 GLSL 里。** 否则色卡（`previewCss`）与实际
 * 出图是两个颜色 —— 文档站的配色页会当场露馅。`pow(c * 1.5, 1/2.2)` 在 c > 0.4
 * 左右就超过 1，GL 在输出时夹掉；这里显式 `Math.min(1, …)` 复现同一个夹取。
 *
 * @param {number} ratio 归一化比例。
 * @returns {[number, number, number]} 0-255 的 RGB 三元组。
 */
function sampleHeatBlobsRgb(ratio) {
  const linear = interpolatePositionedStops(HEAT_BLOB_STOPS, ratio);
  return linear.map((channel) => Math.round(
    255 * Math.min(1, Math.pow((channel / 255) * 1.5, 1 / 2.2)),
  ));
}

/**
 * `heatBlobs` 的 CSS 形式。
 *
 * @param {number} ratio 归一化比例。
 * @returns {string} CSS 颜色字符串。
 */
function sampleHeatBlobs(ratio) {
  const [red, green, blue] = sampleHeatBlobsRgb(ratio);
  return `rgb(${red} ${green} ${blue})`;
}

export const COLORMAPS = [
  {
    id: CLASSIC_ID,
    label: '经典蓝红',
    sample: sampleClassic,
    sampleRgb: sampleClassicRgb,
    previewCss: buildPreviewCss(sampleClassic),
  },
  createStopColormap('thermal', '热成像', [
    [8, 8, 20], [120, 20, 90], [220, 50, 40], [250, 160, 30], [255, 255, 220],
  ]),
  createStopColormap('viridis', 'Viridis', [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ]),
  createStopColormap('inferno', 'Inferno', [
    [0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164],
  ]),
  createStopColormap('grayscale', '灰度', [
    [24, 24, 24], [128, 128, 128], [245, 245, 245],
  ]),
  createStopColormap('iceFire', '冰火', [
    [24, 90, 190], [130, 190, 235], [245, 245, 245], [240, 150, 80], [200, 40, 40],
  ]),
  // jet 不是插值色标，是一条四段折线公式，所以不走 createStopColormap。
  // 它是全仓 18 处老配色用的那条阶梯，登记进来之后画布配置器和 manifest
  // 渲染器第一次能显式选到它 —— 在此之前 jet 只能通过「不选配色」隐式命中。
  {
    id: 'jet',
    label: '彩虹 Jet',
    sample: sampleJet,
    sampleRgb: sampleJetRgb,
    previewCss: buildPreviewCss(sampleJet),
  },
  // 第八条，2026-08-07 第三轮批 4 随 `webglHeatmap` 进包。色标不等距 +
  // 一道 sRGB gamma，所以两条通用工厂都套不上，单独一份采样函数。
  {
    id: 'heatBlobs',
    label: '斑点热力',
    sample: sampleHeatBlobs,
    sampleRgb: sampleHeatBlobsRgb,
    previewCss: buildPreviewCss(sampleHeatBlobs),
  },
];

const COLORMAP_BY_ID = new Map(COLORMAPS.map((item) => [item.id, item]));

export const DEFAULT_COLORMAP_ID = CLASSIC_ID;

/**
 * 按 id 取配色方案，未知 id 回落到 classic，避免坏配置让整张图无法上色。
 *
 * @param {string} id 配色方案 id。
 * @returns {{id: string, label: string, sample: Function, previewCss: string}} 配色方案。
 */
export function getColormap(id) {
  return COLORMAP_BY_ID.get(String(id || '')) || COLORMAP_BY_ID.get(CLASSIC_ID);
}

export function isKnownColormapId(id) {
  return COLORMAP_BY_ID.has(String(id || ''));
}

/**
 * 判断一份配色选择是否等于"改动前的样子"。
 *
 * 3D 场景组件（`NumThreeColor1024`、`hand`）的 classic 通路不是本模块的 hsl 公式，
 * 而是各自原有的 `jet()`。这些组件必须能在循环外一次性判断"要不要走原来那条分支"，
 * 让老展示系统的观感逐字不变。规则收在这里，避免每个场景各写一遍 `id === 'classic'`。
 *
 * @param {{id?: string} | string | null | undefined} colormap 配色选择。
 * @returns {boolean} 不传、没有 id、或 id 就是 classic 时为 true。
 */
export function isClassicColormap(colormap) {
  const id = typeof colormap === 'string' ? colormap : colormap?.id;
  return !id || id === CLASSIC_ID;
}

/**
 * 采样一个颜色。
 *
 * @param {string} id 配色方案 id。
 * @param {number} ratio 归一化比例。
 * @param {{reverse?: boolean}} [options] 是否反向取色。
 * @returns {string} CSS 颜色字符串。
 */
export function sampleColormap(id, ratio, options = {}) {
  const colormap = getColormap(id);
  const safeRatio = clampRatio(ratio);
  return colormap.sample(options?.reverse ? 1 - safeRatio : safeRatio);
}

/**
 * 采样成数值 RGB。WebGL、Canvas 2D 这类只接受数值的渲染路径用这个，
 * 与 `sampleColormap` 取的是同一条色带，两处不会漂移。
 *
 * @param {string} id 配色方案 id。
 * @param {number} ratio 归一化比例。
 * @param {{reverse?: boolean}} [options] 是否反向取色。
 * @returns {[number, number, number]} 0-255 的 RGB 三元组。
 */
export function sampleColormapRgb(id, ratio, options = {}) {
  const colormap = getColormap(id);
  const safeRatio = clampRatio(ratio);
  return colormap.sampleRgb(options?.reverse ? 1 - safeRatio : safeRatio);
}

/**
 * 取预览用的渐变。reverse 时把渐变方向翻过来，色卡与实际出图一致。
 *
 * @param {string} id 配色方案 id。
 * @param {{reverse?: boolean}} [options] 是否反向。
 * @returns {string} CSS linear-gradient。
 */
export function colormapPreviewCss(id, options = {}) {
  const colormap = getColormap(id);
  return options?.reverse
    ? colormap.previewCss.replace('90deg', '270deg')
    : colormap.previewCss;
}

/**
 * 把 jet 阶梯发成一段 GLSL 源码。
 *
 * **为什么是生成而不是再抄一遍。** `Num2D.jsx` / `Num2Doriginal.jsx` 的片元
 * 着色器里各躺着一份手抄的 `jet1()`，断点与斜率和 `core/jetLadder.js` 完全
 * 一致 —— 它们是全仓 jet 阶梯的第 19、20 份拷贝。之前 18 份合并时漏了它们，
 * 因为公式在模板字符串里，`grep "function jet"` 扫不到。所以这里从
 * `JET_LADDER_SEGMENTS` 发码，阶梯仍然只有一个出处。
 *
 * **一处必须保留的行为差异**：GLSL 那份在 `dv == 0.0` 时提前返回
 * `vec3(0.0, 0.0, 1.0)`（纯蓝），而 JS 的 `jetRgb` 在同样输入下 `g` 是
 * `NaN`（`4 * 0 / 0`）。生成器照发 GLSL 那份的提前返回，**画面零变化** ——
 * 这不是在修 JS 那份的 bug，是在保证搬家不改观感。
 *
 * **序言逐字照抄原件的「先夹 x 再相除」**，而不是写成
 * `clamp((x - minVal) / dv, 0.0, 1.0)`。两者在 `dv > 0` 时同解，但
 * `maxVal < minVal` 时不同（原件两次赋值后 `x` 落在 `maxVal`，`t` 恒为 1）。
 * 实际调用永远是 `u_max > u_min`，所以这是个够不到的分支 —— 照抄就不必论证。
 *
 * 与原件唯一的结构差异是：原件用 `float r, g, b` + `if / else if` 链最后
 * `return vec3(r, g, b)`，这里是四段提前 `return`。纯控制流改写，同解。
 *
 * @param {string} [name='jet1'] 生成的函数名，与旧着色器保持一致时传默认值。
 * @returns {string} 可直接拼进片元着色器的 GLSL 函数定义。
 */
export function glslJetLadder(name = 'jet1') {
  const glslFloat = (value) => (Number.isInteger(value) ? `${value}.0` : `${value}`);
  const channel = (spec) => {
    if (typeof spec === 'number') return glslFloat(spec);
    const base = spec.slope > 0 ? 0 : 1;
    return `${glslFloat(base)} + ${glslFloat(spec.slope)} * (t - ${glslFloat(spec.from)})`;
  };

  const branches = JET_LADDER_SEGMENTS.map((segment, index) => {
    const body = `    return vec3(${channel(segment.r)}, ${channel(segment.g)}, ${channel(segment.b)});`;
    // 最后一段不写条件：t 已夹到 [0,1]，`< 1.0` 会漏掉 t == 1.0。
    if (index === JET_LADDER_SEGMENTS.length - 1) return body;
    return `  if (t < ${glslFloat(segment.until)}) {\n${body}\n  }`;
  }).join('\n');

  return `vec3 ${name}(float minVal, float maxVal, float x) {
  if (x < minVal) x = minVal;
  if (x > maxVal) x = maxVal;
  float dv = maxVal - minVal;
  // dv == 0 时 JS 侧的 g 是 NaN，GLSL 侧历来返回纯蓝；照抄 GLSL，画面零变化。
  if (dv == 0.0) return vec3(0.0, 0.0, 1.0);
  float t = (x - minVal) / dv;
${branches}
}`;
}

/**
 * 把一条**不等距色标**发成一段 GLSL 源码（`vec3 name(float pct)`）。
 *
 * 和 `glslJetLadder()` 同一个理由：`WebGL.HeatMap copy 2.js` 的
 * `getColorByPercent` 是手写的 8 段 `mix` 链，断点与颜色和 `HEAT_BLOB_STOPS`
 * 一一对应。发码之后色带只有一个出处 —— 改 `HEAT_BLOB_STOPS` 一处，GLSL、
 * `sampleColormapRgb('heatBlobs')` 和文档站色卡同时跟着走。
 *
 * 生成结果与原件的结构差异只有一处：原件把颜色声明成 `const vec3 c0..c7` 再
 * `mix(cN, cN+1, t)`，这里直接把字面量写进 `mix`。同解，少八行。分段判断照抄
 * 原件的 `p <= 断点` 链（**含最后一段的 `else` 兜底**，所以 `p == 1.0` 不会漏）。
 *
 * @param {string} name 生成的函数名。
 * @param {Array<{at: number, rgb: [number, number, number]}>} stops 升序色标，
 *   `rgb` 是 0-255。
 * @returns {string} 可直接拼进片元着色器的 GLSL 函数定义。
 */
export function glslStopLadder(name, stops) {
  const glslFloat = (value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`;
  };
  const vec3 = (rgb) => `vec3(${rgb.map((c) => glslFloat(c / 255)).join(', ')})`;

  const branches = stops.slice(1).map((upper, index) => {
    const lower = stops[index];
    const body = `    float t = (p - ${glslFloat(lower.at)}) `
      + `/ (${glslFloat(upper.at)} - ${glslFloat(lower.at)});\n`
      + `    return mix(${vec3(lower.rgb)}, ${vec3(upper.rgb)}, t);`;
    // 最后一段不写条件，走 else —— 否则 p == 1.0 会掉出链尾。
    if (index === stops.length - 2) return `  {\n${body}\n  }`;
    return `  if (p <= ${glslFloat(upper.at)}) {\n${body}\n  } else`;
  }).join('\n');

  return `vec3 ${name}(float pct) {
  float p = clamp(pct, 0.0, 1.0);
${branches}
}`;
}
