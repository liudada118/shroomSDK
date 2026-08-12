/**
 * renderers/webglHeatmap/react/blobs.js - 斑点热力的 WebGL 绘制核
 *
 * 搬自 `client/src/components/webgl/WebGL.HeatMap copy 2.js`（953 行）。文件名带
 * "copy 2" 但**不是死码**：`WebGLCanvas` 被 `video/hand.jsx`、`video/humanBody.jsx`、
 * `video/robotLCF.jsx`、`video/robotSY.jsx` 和 `page/home/Home.jsx` 五处在用，
 * `genWebglHeatmap` 被 `Canvas4096WebGL`（现在是本包的 `WebglHeatmapRenderer`）在用。
 * 所以原路径留了一行 `export *` 的壳，那五个消费者一行没改。
 *
 * 放 `react/` 不放 `core/`：它拿 `document` 和 `WebGLRenderingContext`。本文件
 * **不 import React**，只是按分层规矩落在 DOM 那一侧。着色器源码在
 * `renderers/webglHeatmap/core/shaders.js`（纯字符串，裸 Node 可 import）。
 *
 * ## 搬的时候删掉了 5 个死导出（约 250 行）
 *
 * `genAllData` / `genData` 和它们私有的 `interp` / `interpSmall` / `changeArrValue`
 * **全仓零引用** —— 唯一提到它们的是 `Home.jsx:1837-1842` 三行注释掉的代码。
 * 顺带说明两件事：
 *
 * - 计划里写的「私有的 `interp` / `interpSmall` 换成 `core/frameMath.js` 的」
 *   **做不到，也不需要做**。`frameMath.interpSmall` 每个块只写一行并且**乘 10**，
 *   本文件那份写 2 或 4 行、不乘 10 —— 是两个不同的函数，不是重复。`interp` 在
 *   `core` 里根本没有对应物。既然整条链是死的，就不用纠结了。
 * - `changeArrValue` 的**第一条语句就是 `return arr`**，下面 6 行永远执行不到。
 *
 * 私有的 `addSide` 确实与 `core/frameMath.js` 的那份逐字相同，但它也只被
 * `genAllData` 用 —— 一起走了。
 *
 * ## 修掉的每帧泄漏（画面零变化）
 *
 * 原件的 `createTplCanvas` **每调用一次**就新建 4 个 shader、2 个 program、
 * 1 个 framebuffer、1 张纹理、1 个 renderbuffer 和 N 个顶点 buffer，而只
 * `deleteFramebuffer(fb)` 一个。它是**每帧**调用的（`Canvas4096WebGL` 挂在
 * `requestAnimationFrame` 上），60fps 下一分钟泄漏两万多个 GL 对象。
 *
 * 这里把只依赖尺寸的那些（program / FBO / 纹理 / renderbuffer / 全屏四边形）
 * 缓存到画布上，尺寸变了才重建。**为什么画面相同**：着色器源码、uniform、
 * 混合状态、绘制顺序一字未动；唯一的语义差别是复用的那张 FBO 纹理在每帧
 * 绑定后显式 `clear` 了一次 —— 原件靠"新建纹理的初始内容是全 0"达到同样效果
 * （那在规范里其实是未定义值，各家驱动都给 0，所以显式清是**更**确定的写法）。
 *
 * ## ⚠️ 唯一的模块级可变状态：那张共享画布
 *
 * 原件是 `var tplCanvas = document.createElement("canvas")` —— **模块顶层**执行，
 * 全模块共用一张画布、一个 WebGL 上下文。这违反渲染器契约第 2 条，但**不能改成
 * 每实例一张**：`robotLCF.jsx:549`、`robotSY.jsx:530` 和 `Home.jsx:1823` 是在
 * **每帧回调里** `new WebGLCanvas()` 的，一实例一上下文的话一秒钟就撞上
 * "Too many active WebGL contexts"。共享正是这三处能跑起来的原因。
 *
 * 所以保留共享，只做两件事：**改成惰性创建**（模块顶层不再碰 `document`，裸
 * Node import 本文件不会炸），以及把上面那份缓存挂上去。契约第 2 条约束的是
 * **渲染器组件**，`WebglHeatmapRenderer` 本身没有模块级状态 —— 它每次拿到的是
 * 同一张离屏画布，画完立刻 `drawImage` 拷走，和原来一样。
 */

import {
  BLOB_FRAGMENT_SHADER,
  BLOB_VERTEX_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
  COMPOSITE_VERTEX_SHADER,
} from '../core/shaders.js';
import { buildProgram, deleteGlResources } from '../../shared/webgl/glUtil.js';

/** 一次 `drawArrays` 最多喂多少个点（原件写死 3000）。 */
const POINTS_PER_BUFFER = 3000;

/** 每个点占几个 float：x / y / value。 */
const ATTRIBUTES = 3;

/** 见文件头「唯一的模块级可变状态」。惰性创建，全模块共用。 */
let sharedCanvas = null;

/**
 * 取那张共享的离屏画布，第一次调用时才创建。
 *
 * @returns {HTMLCanvasElement} 共享画布。
 * @throws {Error} 没有 `document` 时（裸 Node）。
 */
function getSharedCanvas() {
  if (sharedCanvas) return sharedCanvas;
  if (typeof document === 'undefined') {
    throw new Error('[webglHeatmap] 需要 DOM：blobs.js 只能在浏览器里绘制');
  }
  sharedCanvas = document.createElement('canvas');
  sharedCanvas.className = 'webgl';
  return sharedCanvas;
}

/**
 * 丢掉共享画布上缓存的 GL 资源。尺寸变化和显式 dispose 都走这里。
 *
 * @param {HTMLCanvasElement} canvas 共享画布。
 * @returns {void}
 */
function releaseCache(canvas) {
  const cache = canvas.glCache;
  if (!cache) return;
  const { gl } = cache;
  // deleteGlResources 一次只收一个 program（那是它三个原调用点的形状），
  // 这里两个 program 就调两次；纹理和 buffer 顺带塞进第一次。
  deleteGlResources(gl, {
    ...(cache.blob || {}),
    textures: [cache.texture].filter(Boolean),
    buffers: [cache.pointBuffer, cache.quadBuffer].filter(Boolean),
  });
  deleteGlResources(gl, cache.composite || {});
  if (cache.framebuffer) gl.deleteFramebuffer(cache.framebuffer);
  if (cache.renderbuffer) gl.deleteRenderbuffer(cache.renderbuffer);
  canvas.glCache = null;
}

/**
 * 释放共享画布持有的一切。消费者退出前可以调；不调也只是一个上下文常驻。
 *
 * @returns {void}
 */
export function disposeSharedHeatmapCanvas() {
  if (!sharedCanvas) return;
  releaseCache(sharedCanvas);
  sharedCanvas = null;
}

/**
 * 建好（或复用）共享画布上的 GL 资源。
 *
 * @param {HTMLCanvasElement} canvas 共享画布。
 * @param {number} width 画布宽。
 * @param {number} height 画布高。
 * @returns {object | null} 缓存对象；拿不到上下文或编译失败时 `null`。
 */
function ensureCache(canvas, width, height) {
  if (canvas.glCache && canvas.glCache.width === width && canvas.glCache.height === height) {
    return canvas.glCache;
  }
  releaseCache(canvas);

  // 先设尺寸再取上下文：与原件同序。设 width/height 会重置绘图缓冲区，
  // 但不会丢上下文，所以 getContext 拿到的始终是同一个 gl。
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl');
  if (!gl) {
    console.warn('[webglHeatmap] 拿不到 WebGL 上下文，这一块画不出来');
    return null;
  }

  const blob = buildProgram(gl, BLOB_VERTEX_SHADER, BLOB_FRAGMENT_SHADER);
  const composite = buildProgram(gl, COMPOSITE_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER);
  if (!blob || !composite) return null;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  const renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    // 原件在这里 `alert()` —— 一个画不出来的图不该弹窗打断整个应用。
    console.warn('[webglHeatmap] 帧缓冲附件组合不被支持，这一块画不出来');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return null;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const cache = {
    gl,
    width,
    height,
    blob,
    composite,
    texture,
    renderbuffer,
    framebuffer,
    pointBuffer: gl.createBuffer(),
    quadBuffer: gl.createBuffer(),
    blobUniforms: {
      resolution: gl.getUniformLocation(blob.program, 'u_resolution'),
      maxClick: gl.getUniformLocation(blob.program, 'u_maxClick'),
      minClick: gl.getUniformLocation(blob.program, 'u_minClick'),
      filterClick: gl.getUniformLocation(blob.program, 'u_filterClick'),
      blurFactor: gl.getUniformLocation(blob.program, 'u_blurFactor'),
    },
    blobAttribs: {
      center: gl.getAttribLocation(blob.program, 'a_center'),
      radius: gl.getAttribLocation(blob.program, 'a_radius'),
      click: gl.getAttribLocation(blob.program, 'a_click'),
    },
    compositeUniforms: {
      resolution: gl.getUniformLocation(composite.program, 'u_resolution'),
    },
    compositeAttribs: {
      position: gl.getAttribLocation(composite.program, 'a_Position'),
    },
  };

  // 全屏四边形是常量，建一次就够。
  gl.bindBuffer(gl.ARRAY_BUFFER, cache.quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  canvas.glCache = cache;
  return cache;
}

/**
 * 斑点热力的绘制核。
 *
 * 公开面与原件逐字一致（`render` / `reset` / `dataCuter` / `bufferCuter` /
 * `getNearPower` / `createTplCanvas`），四个 video 场景组件因此一行不用改。
 * 构造函数只挂着色器源码，很轻 —— 每帧 `new` 一个是原来的用法，仍然成立。
 */
export class WebGLCanvas {
  constructor() {
    this.vertexShader = BLOB_VERTEX_SHADER;
    this.fragmentShader = BLOB_FRAGMENT_SHADER;
    this.vertexShader1 = COMPOSITE_VERTEX_SHADER;
    this.fragmentShader1 = COMPOSITE_FRAGMENT_SHADER;
  }
}

/**
 * 把点表按每 3000 个切段，并转成 `Float32Array`。
 *
 * ⚠️ **会 `splice` 掉入参数组**（原件行为，照抄）。调用方传进来的数组用完就空了。
 *
 * @param {Array<[number, number, number]>} arr 点表；会被清空。
 * @returns {Float32Array[]} 分段后的顶点数据。
 */
WebGLCanvas.prototype.bufferCuter = function bufferCuter(arr) {
  const buffers = [];
  let current = arr.splice(0, POINTS_PER_BUFFER);
  while (current.length > 0) {
    buffers.push(current);
    current = arr.splice(0, POINTS_PER_BUFFER);
  }
  return buffers.map((chunk) => {
    const flat = new Float32Array(chunk.length * ATTRIBUTES);
    for (let i = 0; i < chunk.length; i += 1) {
      flat[i * ATTRIBUTES] = chunk[i][0];
      flat[i * ATTRIBUTES + 1] = chunk[i][1];
      flat[i * ATTRIBUTES + 2] = chunk[i][2];
    }
    return flat;
  });
};

/**
 * 按画布高度把点表切成若干"屏"，`margin` 内的点在相邻屏里各留一份（防止拼接处
 * 的圆被切掉半个）。
 *
 * ⚠️ **原地取整并原地排序入参**（原件行为，照抄）。
 *
 * @param {{height: number}} cfg 画布配置。
 * @param {Array<[number, number, number]>} data 点表。
 * @param {number} margin 重叠余量。
 * @returns {Array<Array<[number, number, number]>>} 按屏分组的点表。
 */
WebGLCanvas.prototype.dataCuter = function dataCuter(cfg, data, margin) {
  const result = [];
  for (let i = 0; i < data.length; i += 1) {
    for (let j = 0; j < data[i].length; j += 1) {
      data[i][j] = parseInt(data[i][j], 10);
    }
  }
  data.sort((a, b) => a[1] - b[1]);

  for (let i = 0; i < data.length; i += 1) {
    const [x, y, c] = data[i];
    const modY = y % cfg.height;
    const gp = Math.floor(y / cfg.height);
    if (!result[gp]) result[gp] = [];
    result[gp].push([x, y - gp * cfg.height, c]);
    if (cfg.height - modY < margin) {
      if (!result[gp + 1]) result[gp + 1] = [];
      result[gp + 1].push([x, y - (gp + 1) * cfg.height, c]);
    }
    if (modY < margin && gp - 1 >= 0) {
      if (!result[gp - 1]) result[gp - 1] = [];
      result[gp - 1].push([x, cfg.height + modY, c]);
    }
  }
  return result;
};

/**
 * 原件里这是"向上取到 2 的幂"，但**整个函数体被注释掉了，只剩 `return num`**。
 * 照抄 —— 恢复取整会改变画布尺寸，也就是改画面。
 *
 * @param {number} num 尺寸。
 * @returns {number} 原样返回。
 */
WebGLCanvas.prototype.getNearPower = function getNearPower(num) {
  return num;
};

/**
 * 画一屏：先把点累加进离屏纹理的 alpha 通道，再查色带合成到画布上。
 *
 * @param {object} cfg 配置：`width` / `height` / `radius` / `max` / `min` /
 *   `filter` / 可选 `blurFactor`。
 * @param {Float32Array[]} data `bufferCuter` 出来的分段顶点数据。
 * @returns {HTMLCanvasElement | null} 共享画布；拿不到上下文时 `null`。
 */
WebGLCanvas.prototype.createTplCanvas = function createTplCanvas(cfg, data) {
  const canvas = getSharedCanvas();
  const width = cfg.width || 2048;
  const height = cfg.height || 1024;
  const cache = ensureCache(canvas, width, height);
  if (!cache) return null;

  canvas.glObj = { canvas, data, cfg, gl: cache.gl };
  canvas.resetCfg = (nextCfg) => {
    canvas.glObj.cfg = nextCfg;
    drawFrame(canvas, nextCfg, canvas.glObj.data);
  };

  drawFrame(canvas, cfg, data);
  return canvas;
};

/**
 * 两趟绘制。抽成模块函数是为了让 `resetCfg` 能再调一次，与原件的闭包 `draw()`
 * 等价。
 *
 * @param {HTMLCanvasElement} canvas 共享画布。
 * @param {object} cfg 配置。
 * @param {Float32Array[]} data 分段顶点数据。
 * @returns {void}
 */
function drawFrame(canvas, cfg, data) {
  const cache = canvas.glCache;
  if (!cache) return;
  const { gl, blob, composite, blobUniforms, blobAttribs } = cache;

  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  // 源色与现有色相加 —— 斑点的"热度"就是这么叠出来的。
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.viewport(0, 0, cache.width, cache.height);

  // ---- 第一趟：把点画进离屏纹理的 alpha ----
  gl.useProgram(blob.program);
  gl.uniform2f(blobUniforms.resolution, cache.width, cache.height);
  gl.uniform1f(blobUniforms.maxClick, cfg.max);
  gl.uniform1f(blobUniforms.minClick, cfg.min);
  gl.uniform1f(blobUniforms.filterClick, cfg.filter);
  gl.uniform1f(blobUniforms.blurFactor, cfg.blurFactor != null ? cfg.blurFactor : 0.55);
  gl.vertexAttrib1f(blobAttribs.radius, cfg.radius + 1);

  gl.bindFramebuffer(gl.FRAMEBUFFER, cache.framebuffer);
  // 复用纹理就必须显式清 —— 原件靠"每帧新建一张纹理"隐式得到全 0。
  gl.clear(gl.COLOR_BUFFER_BIT);

  const stride = ATTRIBUTES * Float32Array.BYTES_PER_ELEMENT;
  gl.bindBuffer(gl.ARRAY_BUFFER, cache.pointBuffer);
  gl.enableVertexAttribArray(blobAttribs.center);
  gl.enableVertexAttribArray(blobAttribs.click);
  gl.vertexAttribPointer(blobAttribs.center, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribPointer(
    blobAttribs.click, 1, gl.FLOAT, false, stride, Float32Array.BYTES_PER_ELEMENT * 2,
  );
  for (let i = 0; i < data.length; i += 1) {
    const chunk = data[i];
    gl.bufferData(gl.ARRAY_BUFFER, chunk, gl.STATIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, chunk.length / ATTRIBUTES);
  }

  // ---- 第二趟：查色带，合成到默认帧缓冲 ----
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(composite.program);
  gl.uniform2f(cache.compositeUniforms.resolution, cache.width, cache.height);
  gl.bindBuffer(gl.ARRAY_BUFFER, cache.quadBuffer);
  gl.enableVertexAttribArray(cache.compositeAttribs.position);
  gl.vertexAttribPointer(cache.compositeAttribs.position, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * 画一整份点表，按画布高度切成若干屏。
 *
 * ⚠️ 返回的每一项都是**同一张**共享画布 —— 原件如此。所以调用方必须在拿到之后
 * 立刻 `drawImage` 拷走，不能攒着一批最后一起用。
 *
 * ⚠️ 原签名还有第三个参数 `index`，四个 video 场景组件和 `Home.jsx` 都在传
 * `'dynamic'`。它**只出现在注释掉的代码里**（那份"每个 index 一张画布"的旧
 * 缓存方案），实现里从没读过 —— 所以这里不再声明它。JS 多传的实参会被忽略，
 * 那五个调用点一个字都不用改。
 *
 * @param {object} cfg 配置。
 * @param {Array<[number, number, number]>} data 点表。
 * @returns {Array<HTMLCanvasElement>} 每屏一张（其实是同一张）。
 */
WebGLCanvas.prototype.render = function render(cfg, data) {
  cfg.width = this.getNearPower(cfg.width);
  cfg.height = this.getNearPower(cfg.height);

  const queue = [];
  const cutedData = this.dataCuter(cfg, data, 0);
  for (let i = 0; i < cutedData.length; i += 1) {
    if (!cutedData[i]) continue;
    const canvas = this.createTplCanvas(cfg, this.bufferCuter(cutedData[i]));
    if (canvas) queue.push(canvas);
  }
  return queue;
};

/**
 * 换一份 cfg 重画已有的画布。
 *
 * @param {object} cfg 新配置。
 * @param {Array<HTMLCanvasElement>} canvasArr `render` 的返回值。
 * @returns {void}
 */
WebGLCanvas.prototype.reset = function reset(cfg, canvasArr) {
  for (let i = 0; i < canvasArr.length; i += 1) {
    canvasArr[i]?.resetCfg?.(cfg);
  }
};

/**
 * 一帧数据 → 一张画好的热力画布。
 *
 * 前五个参数是原签名，`Canvas4096WebGL` 就是这么调的；第六个 `options` 是本轮
 * 加的，把原来写死在函数体里的矩阵尺寸和数值缩放放出来。不传就是原行为。
 *
 * @param {number[]} dataArr 一帧数据。
 * @param {number} [heatMapMax=12] 满值阈值。
 * @param {number} [heatMapRadius=24] 点半径，像素。
 * @param {number} [canvasWidth=256] 画布宽。
 * @param {number} [canvasHeight=256] 画布高。
 * @param {{dataWidth?: number, dataHeight?: number, valueScale?: number,
 *   blurFactor?: number}} [options] 额外参数。
 * @returns {HTMLCanvasElement | null} 画好的画布。
 */
export function genWebglHeatmap(
  dataArr,
  heatMapMax = 12,
  heatMapRadius = 24,
  canvasWidth = 256,
  canvasHeight = 256,
  options = {},
) {
  const dataWidth = options.dataWidth || 64;
  const dataHeight = options.dataHeight || 64;
  const valueScale = options.valueScale != null ? options.valueScale : 1.8;

  const points = [];
  const stepX = canvasWidth / dataWidth;
  const stepY = canvasHeight / dataHeight;
  for (let row = 0; row < dataHeight; row += 1) {
    for (let col = 0; col < dataWidth; col += 1) {
      const value = dataArr[row * dataWidth + col];
      points.push([col * stepX, row * stepY, value ? value * valueScale : 0]);
    }
  }

  const painter = new WebGLCanvas();
  const queue = painter.render({
    width: canvasWidth,
    height: canvasHeight,
    radius: heatMapRadius,
    max: heatMapMax,
    min: 0,
    filter: 0,
    blurFactor: options.blurFactor,
    class: 'body',
  }, points);
  return queue[0] || null;
}

export default WebGLCanvas;
