/**
 * renderers/numMatrix/core/shaders.js - webgl 后端的 GLSL 源码（编译期开关）
 *
 * `Num2D.jsx` 与 `Num2Doriginal.jsx` 各带一份片元着色器。**两份逐行比对只差
 * 18 行，每一行都是后者在加东西**：`u_mask` / `u_useMask` / `u_texScale` 三个
 * uniform、掩码外显白、零值显白。所以这里是**一份模板 + 两个布尔开关**，
 * 不是两份源码。
 *
 * 开关做成**编译期**（拼字符串）而不是运行期 uniform：变体最多 4 种，而
 * `if` 在片元着色器里是每像素代价。`u_useMask` 保留成 uniform 是因为
 * `Num2Doriginal` 本来就那样 —— 同一个 program 要在「规则网格」和「机器人
 * 分区」之间来回切，切的时候不重编译。
 *
 * ## `u_texScale` 为什么不做成开关
 *
 * `Num2D` 那份没有这个 uniform，直接用 `v_texCoord`。这里**总是**发它，
 * POT 关掉时后端传 `(1.0, 1.0)` —— 乘 1 是恒等变换，画面逐像素相同，
 * 而后端少一条「这个 uniform 在不在」的分支。
 *
 * ## 配色只有 jet
 *
 * 片元里那条阶梯由 `glslJetLadder()` 从 `core/jetLadder.js` 的断点数据发码，
 * 全仓 jet 仍然只有一个出处（详见 `colormaps.js` 里那段注释）。
 *
 * **但本后端目前只画 jet**：选了别的配色，画面仍然是 jet。两份原实现都写死
 * jet，照搬就不会改观感；补齐要么发 7 份 GLSL、要么烘一张 256 级 LUT 纹理，
 * 后者会把逐像素求值换成 256 级量化 —— 都不是「零变化」，所以留给单独一轮。
 * `buildFragmentShader({ colormapGlsl })` 是给二开留的注入点：传一段自己的
 * `vec3 jet1(float, float, float)` 就换掉配色，不用改这个文件。
 */

import { glslJetLadder } from '../../../core/colormaps.js';

/**
 * 顶点着色器。两份原实现里逐字相同，没有任何开关。
 *
 * 画的是一个铺满裁剪空间的双三角形（见 `QUAD_POSITIONS`），所以
 * `gl_Position` 直接用 `a_position`，不需要任何矩阵。
 */
export const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/**
 * 铺满屏的两个三角形，逐字抄自两份原实现。
 *
 * `texCoords` 的 v 是**翻过来的**（`0,1` 对应左下），所以纹理第 0 行画在
 * 画面顶部 —— 数据是行优先的，这样第 0 行就在上面。别"顺手改正"成 `0,0`。
 */
export const QUAD_POSITIONS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
export const QUAD_TEX_COORDS = [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0];

/** 数据纹理里 `.r` 通道的量程：`LUMINANCE` 归一化到 [0,1]，乘回 255。 */
const TEXTURE_VALUE_SCALE = '255.0';

/**
 * 拼一份片元着色器。
 *
 * @param {object} [options] 编译期开关。
 * @param {boolean} [options.useMask=false] 发 `u_mask` / `u_useMask`，掩码外显白。
 *   机器人分区布局要它 —— 分区之间的空隙不能被涂成 jet 的蓝色。
 * @param {boolean} [options.whiteOnZero=false] 值 `< 0.5` 直接输出白。
 *   这是 `Num2Doriginal` 的行为（裸数据展示形式白底），`Num2D` 没有。
 * @param {string} [options.colormapGlsl] 覆盖配色函数的 GLSL 源码。必须定义
 *   `vec3 jet1(float minVal, float maxVal, float x)`。默认是生成的 jet 阶梯。
 * @returns {string} 完整的片元着色器源码。
 */
export function buildFragmentShader(options = {}) {
  const useMask = Boolean(options.useMask);
  const whiteOnZero = Boolean(options.whiteOnZero);
  const colormapGlsl = options.colormapGlsl || glslJetLadder('jet1');

  const maskUniforms = useMask
    ? '  uniform sampler2D u_mask;\n  uniform float u_useMask;\n'
    : '';

  // 掩码判断在零值判断**之前** —— 原实现如此。两者都输出白，所以次序对画面
  // 没影响，照抄是为了将来谁改了其中一支时次序仍然是原来的。
  const maskBranch = useMask
    ? `    if (u_useMask > 0.5) {
      float maskVal = texture2D(u_mask, scaledCoord).r;
      if (maskVal < 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
      }
    }
`
    : '';

  const zeroBranch = whiteOnZero
    ? `    // 0值显示白色背景
    if (value < 0.5) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      return;
    }
`
    : '';

  return `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_data;
${maskUniforms}  uniform float u_min;
  uniform float u_max;
  uniform vec2 u_texScale;

${colormapGlsl.split('\n').map((line) => (line ? `  ${line}` : line)).join('\n')}

  void main() {
    vec2 scaledCoord = v_texCoord * u_texScale;
    float value = texture2D(u_data, scaledCoord).r * ${TEXTURE_VALUE_SCALE};
${maskBranch}${zeroBranch}    vec3 color = jet1(u_min, u_max, value);
    gl_FragColor = vec4(color, 1.0);
  }
`;
}

/**
 * 四种变体的名字，给测试与文档用。**不是**运行期开关的载体 ——
 * 后端读的是参数里的两个布尔，不是这张表。
 */
export const FRAGMENT_VARIANTS = {
  plain: { useMask: false, whiteOnZero: false },
  whiteOnZero: { useMask: false, whiteOnZero: true },
  masked: { useMask: true, whiteOnZero: false },
  maskedWhiteOnZero: { useMask: true, whiteOnZero: true },
};
