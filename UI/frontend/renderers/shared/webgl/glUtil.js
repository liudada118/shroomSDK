/**
 * renderers/shared/webgl/glUtil.js - WebGL 1.0 的最小公共件
 *
 * 全仓有**三份**逐字相同的 `createShader` / `createProgram`：
 * `Num2D.jsx:133-158`、`Num2Doriginal.jsx:164-185`、
 * `components/webgl/WebGL.HeatMap copy 2.js:865-940`（后者叫 `create_shader` /
 * `create_program`，多打了两句 `console.log`）。这里是那一份。
 *
 * 放在 `react/` 而不是 `core/`：它拿的是 `WebGLRenderingContext`，属于"要浏览器"
 * 那一侧。`core/` 的界线是「有没有 React / three / DOM」，`gl` 对象算 DOM 侧。
 * 本文件**不 import React**，所以裸 Node 里 import 它不会炸，只是没有 gl 可用。
 *
 * ## 编译失败为什么不抛
 *
 * 三份原实现都是 `return null`，调用方再 `if (!gl) return`。照抄 —— 抛异常会让
 * 一块画不出来的图把整个页面带崩，而 WebGL 在虚拟机、远程桌面、老显卡上拿不到
 * 上下文是常态。**代价是失败时画面只是空白**，所以这里比原实现多做一件事：
 * 把 `getShaderInfoLog` / `getProgramInfoLog` 打进 `console.warn`。原实现两份
 * 一声不吭（第三份打 `console.log`），排查时只能靠猜。
 */

/**
 * 编译一个着色器。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {number} type `gl.VERTEX_SHADER` 或 `gl.FRAGMENT_SHADER`。
 * @param {string} source GLSL 源码。
 * @returns {WebGLShader | null} 编译失败返回 `null`（已 delete，不泄漏）。
 */
export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    console.warn(`[glUtil] ${kind} shader 编译失败:`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * 链接一个 program。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {WebGLShader} vs 顶点着色器。
 * @param {WebGLShader} fs 片元着色器。
 * @returns {WebGLProgram | null} 链接失败返回 `null`。
 */
export function createProgram(gl, vs, fs) {
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[glUtil] program 链接失败:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * 编译 + 链接一步到位，并把两个 shader 一起带出来（dispose 时要 delete）。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {string} vertexSrc 顶点着色器源码。
 * @param {string} fragmentSrc 片元着色器源码。
 * @returns {{program: WebGLProgram, vs: WebGLShader, fs: WebGLShader} | null}
 *   任一步失败返回 `null`，且已编译出来的那个会被 delete。
 */
export function buildProgram(gl, vertexSrc, fragmentSrc) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    // 原实现在这里直接把 null 传给 createProgram，靠 attachShader 静默失败兜住。
    // 这里显式清掉已经编出来的那个 —— 行为上等价（都画不出来），但不漏资源。
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = createProgram(gl, vs, fs);
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  return { program, vs, fs };
}

/**
 * 绑一个顶点属性数组。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {WebGLProgram} program 已 `useProgram` 的 program。
 * @param {string} name 属性名。
 * @param {number[]} values 分量数组。
 * @param {number} [size=2] 每个顶点几个分量。
 * @returns {WebGLBuffer} 新建的 buffer，dispose 时要 delete。
 */
export function bindAttribBuffer(gl, program, name, values, size = 2) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return buffer;
}

/**
 * 建一张 `LUMINANCE` 单通道纹理，`NEAREST` + `CLAMP_TO_EDGE`。
 *
 * 四个 `texParameteri` 缺一不可：WebGL 1.0 对 NPOT 纹理只允许 `CLAMP_TO_EDGE`
 * + 非 mipmap 过滤，否则采样恒为黑。本仓的数据纹理已经统一走 POT（见
 * `nextPOT`），但这几行仍然留着 —— `NEAREST` 是观感要求（格子要硬边，不能糊）。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {number} unit 纹理单元号（0 / 1 / …）。
 * @param {number} width 纹理宽（应为 2 的幂）。
 * @param {number} height 纹理高（应为 2 的幂）。
 * @returns {{texture: WebGLTexture, data: Uint8Array}} 纹理与它的 CPU 侧缓冲。
 */
export function createLuminanceTexture(gl, unit, width, height) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const data = new Uint8Array(width * height);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0,
    gl.LUMINANCE, gl.UNSIGNED_BYTE, data,
  );
  return { texture, data };
}

/**
 * 把 CPU 侧缓冲整张推上去。
 *
 * 用 `texSubImage2D` 而不是重新 `texImage2D`：后者每帧重新分配显存。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {number} unit 纹理单元号。
 * @param {WebGLTexture} texture 目标纹理。
 * @param {Uint8Array} data 数据（长度必须是 `width * height`）。
 * @param {number} width 纹理宽。
 * @param {number} height 纹理高。
 */
export function uploadLuminance(gl, unit, texture, data, width, height) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0, width, height,
    gl.LUMINANCE, gl.UNSIGNED_BYTE, data,
  );
}

/**
 * 释放一组 GPU 资源。传进来的字段都是可选的，`null` 会被跳过。
 *
 * ⚠️ **这里不叫 `forceContextLoss()`**。原实现也没有，加上去是行为改变（上下文
 * 一旦丢失，同一个 canvas 再也拿不回来），而本仓有「反复切展示形式」的用法。
 * 「dispose 缺 forceContextLoss，上下文靠 GC 回收」是积压里的老条目，不在这一轮。
 *
 * @param {WebGLRenderingContext} gl 上下文。
 * @param {object} resources 要删的东西。
 */
export function deleteGlResources(gl, resources = {}) {
  if (!gl) return;
  const { program, vs, fs, textures = [], buffers = [] } = resources;
  textures.forEach((texture) => { if (texture) gl.deleteTexture(texture); });
  buffers.forEach((buffer) => { if (buffer) gl.deleteBuffer(buffer); });
  if (program) gl.deleteProgram(program);
  if (vs) gl.deleteShader(vs);
  if (fs) gl.deleteShader(fs);
}

/**
 * 已经预热过的着色器源码组合。
 *
 * **这是本包里唯一允许的模块级可变状态**，契约第 2 条（不得持有模块级可变状态）
 * 的例外，理由是它不是渲染状态而是**进程级的幂等缓存**：预热的作用是让驱动把
 * 这段 GLSL 编译一次，第二次编同一段就命中驱动自己的缓存了。它不影响任何一块
 * 画布的画面，两块同时挂也不会互相踩 —— 最坏结果是白预热一次。
 *
 * 原实现是每个文件一个布尔（`_shaderPrewarmed` / `_shaderPrewarmedOriginal`），
 * 换成按源码去重的 Set 之后，两个变体的着色器各自预热一次，而不是靠文件分。
 */
const prewarmedSources = new Set();

/**
 * 预热着色器编译。
 *
 * 第一次拿到真实数据时才建上下文的话，那一帧要等驱动编译 GLSL（在某些集显上
 * 是几十到几百毫秒），表现为切过去先黑一下。所以在挂载时先拿一张 1×1 的
 * canvas 把同一段源码编一遍，编完立刻丢掉。抄自 `Num2Doriginal.jsx:505-524`。
 *
 * @param {string} vertexSrc 顶点着色器源码。
 * @param {string} fragmentSrc 片元着色器源码。
 */
export function prewarmShaders(vertexSrc, fragmentSrc) {
  const key = `${vertexSrc} ${fragmentSrc}`;
  if (prewarmedSources.has(key)) return;
  prewarmedSources.add(key);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl', { antialias: false });
    if (!gl) return;
    const built = buildProgram(gl, vertexSrc, fragmentSrc);
    if (built) deleteGlResources(gl, built);
    // 预热用的这个上下文是即用即弃的，这里丢掉它是对的 —— 浏览器同时能活的
    // WebGL 上下文有上限（通常 16），不主动丢会挤掉真正在画的那些。
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  } catch {
    // 拿不到 canvas / WebGL（SSR、无头环境）就算了，预热失败不影响正确性。
  }
}
