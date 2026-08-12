/**
 * renderers/webglHeatmap/core/shaders.js - 斑点热力的四段着色器源码
 *
 * 来自 `client/src/components/webgl/WebGL.HeatMap copy 2.js` 的 `WebGLCanvas`
 * 构造函数（原件把四段 GLSL 用 `"\ … \"` 行尾续行拼在一起，本文件改成模板字符串
 * —— 纯写法差异，编译出来的源码等价）。
 *
 * 放 `core/` 是因为它们只是字符串：没有 `gl`、没有 DOM，裸 Node 可以 import，
 * `smoke-core.mjs` 因此能对生成结果做断言。真正拿它们去编译的是
 * `renderers/webglHeatmap/react/blobs.js`。
 *
 * ## 两趟渲染
 *
 * 第一趟（`BLOB_VERTEX_SHADER` / `BLOB_FRAGMENT_SHADER`）把每个数据点画成一个
 * 半径 `radius` 的圆点，**只写 alpha 通道**（RGB 恒为 0），混合模式是
 * `SRC_ALPHA + ONE` 累加，渲进一张离屏纹理。所以那张纹理的 alpha 就是"热度"。
 *
 * 第二趟（`COMPOSITE_VERTEX_SHADER` / `buildCompositeFragmentShader()`）画一个
 * 铺满屏的四边形，把上一趟的 alpha 当百分比查色带，再做一次 sRGB gamma。
 *
 * ## 原件里三处**照抄不改**的怪东西
 *
 * 1. `u_filterClick` / `v_filterClick` 一路声明、赋值、传递，**片元里从没读过**。
 *    调用方也一直传 `filter: 0`。留着，删它是另一件事。
 * 2. 斑点片元有一段**空分支**：`if (diff >= 0.0 && diff <= 1.0) { }` —— 圆的最外
 *    一像素环既不写颜色也不 discard，`gl_FragColor` 保持未定义。GLSL 规范下这是
 *    未定义值，实测各家驱动都给 0，所以画面上看不出来。逐字保留。
 * 3. 顶点着色器声明了 `a_Position` 却不用（真正的位置来自 `a_center`），
 *    片元里 `v_groupIdx` 同理。留着。
 */

import { glslStopLadder, HEAT_BLOB_STOPS } from '../../../core/colormaps.js';

/**
 * 斑点顶点着色器：把 `a_center`（像素坐标）换成裁剪坐标，点尺寸 = 半径 × 2。
 */
export const BLOB_VERTEX_SHADER = `
attribute vec4 a_Position;
uniform vec2 u_resolution;
uniform float u_maxClick;
uniform float u_minClick;
uniform float u_filterClick;
attribute float a_click;
attribute vec2 a_center;
attribute float a_radius;
varying vec2 v_center;
varying vec2 v_resolution;
varying float v_radius;
varying float v_maxClick;
varying float v_minClick;
varying float v_filterClick;
varying float v_click;
void main() {
  gl_PointSize = a_radius * 2.0;
  vec2 clipspace = a_center / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clipspace * vec2(1, -1), 0, 1);
  v_center = a_center;
  v_resolution = u_resolution;
  v_radius = a_radius - 1.0;
  v_maxClick = u_maxClick;
  v_minClick = u_minClick;
  v_filterClick = u_filterClick;
  v_click = a_click;
}`;

/**
 * 斑点片元着色器：按到圆心的距离做一圈线性羽化，只写 alpha。
 *
 * `blurFactory`（默认 0.55）是"实心区占半径的比例"：`diff > radius * blurFactory`
 * 的部分给满 alpha，其余按 `diff / (radius * blurFactory)` 线性衰减到 0。
 */
export const BLOB_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_center;
varying vec2 v_resolution;
varying float v_radius;
varying float v_maxClick;
varying float v_minClick;
varying float v_filterClick;
varying float v_click;
varying float v_groupIdx;
uniform float u_blurFactor;
void main() {
  vec4 color0 = vec4(0.0, 0.0, 0.0, 0.0);
  float x = gl_FragCoord.x;
  float y = v_resolution[1] - gl_FragCoord.y;
  float dx = v_center[0] - x;
  float dy = v_center[1] - y;
  float distance = sqrt(dx*dx + dy*dy);
  float diff = v_radius-distance;
  float currentPercent=0.95;
  float blurFactory=u_blurFactor;
  float pxAlpha=0.0;
  if(v_maxClick>= v_click && v_click>= v_minClick){
    pxAlpha = (v_click-v_minClick)/(v_maxClick-v_minClick);
  }
  if(v_click>= v_maxClick){
    pxAlpha = 1.0;
  }
  if ( diff >  0.0 ) {
    if(diff > v_radius * blurFactory) {
      gl_FragColor = vec4(0,0,0,pxAlpha);
    } else {
      float p=diff/(v_radius*blurFactory);
      gl_FragColor = vec4(0,0,0,p*pxAlpha);
    }
  } else {
    if ( diff >= 0.0 && diff <= 1.0 ){
    }
    else{
      gl_FragColor = vec4(0,0,0,0);
    }
  }
}`;

/**
 * 合成顶点着色器：铺满屏的四边形，什么都不算。
 */
export const COMPOSITE_VERTEX_SHADER = `
attribute vec4 a_Position;
void main(void){
  gl_Position = a_Position;
}`;

/**
 * 低于这个 alpha 的像素直接 `discard`（不是画成透明 —— 有区别：discard 连深度
 * 都不写）。原件写死 0.03。
 */
export const BLOB_ALPHA_CUTOFF = 0.03;

/**
 * 发一段合成片元着色器。
 *
 * 色带从 `core/colormaps.js` 的 `HEAT_BLOB_STOPS` **发码**，不是第二份手抄 ——
 * 和 `numMatrix` 的 jet 阶梯同一个做法。`linearToSRGB` 那句
 * `pow(color * 1.5, 1/2.2)` 逐字保留，`colormaps.js` 的 `sampleHeatBlobsRgb`
 * 在 JS 侧复现了同一道 gamma，所以色卡和出图同色。
 *
 * @param {object} [options] 选项。
 * @param {Array<{at: number, rgb: [number, number, number]}>} [options.stops]
 *   色标，默认 `HEAT_BLOB_STOPS`。
 * @param {number} [options.alphaCutoff] discard 阈值，默认 0.03。
 * @returns {string} GLSL 源码。
 */
export function buildCompositeFragmentShader(options = {}) {
  const stops = options.stops || HEAT_BLOB_STOPS;
  const cutoff = Number.isFinite(options.alphaCutoff)
    ? options.alphaCutoff
    : BLOB_ALPHA_CUTOFF;

  return `
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D u_Sampler;

vec3 linearToSRGB(vec3 color){
  return pow(color * 1.5, vec3(1.0/2.2));
}

${glslStopLadder('getColorByPercent', stops)}

void main(void){
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, gl_FragCoord.y / u_resolution.y);
  vec4 c = texture2D(u_Sampler, uv);
  float p_alpha = c.a;
  if(p_alpha > ${cutoff.toFixed(4)}){
    vec3 col = getColorByPercent(p_alpha);
    col = linearToSRGB(col);
    gl_FragColor = vec4(col, 1.0);
  }else{
    discard;
  }
}`;
}

/**
 * 默认合成片元着色器 —— 与原件 `fragmentShader1` 等价。
 */
export const COMPOSITE_FRAGMENT_SHADER = buildCompositeFragmentShader();
