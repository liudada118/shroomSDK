/**
 * webgl.js - 数字矩阵的 WebGL 后端（热场 + Canvas 2D 数字叠加层）
 *
 * 由 `client/src/components/num/Num2D.jsx`（860 行）与
 * `Num2Doriginal.jsx`（1203 行）**合成一份**。合得成的理由在计划里已经量过：
 * 两份的片元着色器逐行比对只差 18 行，**每一行都是后者在加东西**，JS 侧同理。
 * `Num2Doriginal ⊃ Num2D`，所以这里是一个后端 + 一组开关，不是两个后端。
 *
 * 开关全部在 `renderers/numMatrix/core/params.js` 的 `config.webgl` 里，两套缺省值由
 * `variant: 'plain' | 'original'` 选出来：
 *
 * | 参数 | `plain`（Num2D） | `original`（Num2Doriginal） |
 * | :--- | :--- | :--- |
 * | `useMask` / `whiteOnZero` | 关 | 开 |
 * | `potTexture` | 纹理就是矩阵尺寸 | `nextPOT` + `u_texScale` |
 * | `maxFromThreshold` | 色标上限恒取帧内最大 | `valuej1 > 0` 时用它 |
 * | `retintOnTuning` | 拖滑块不重画 | 重推最后一帧 |
 * | `indexRow` / `overlayPad` | 无 / 0 | 底部列号带 / 30 |
 * | `refitOnSizeChange` | 换纹理尺寸**不**动格子边长 | 重算 |
 * | `glove.mode` | `scatter32`（36×36） | `rows15`（15×10 或 15×13） |
 * | `foot.mode` | `interp`（16×32 插值） | `raw`（6×10 原样） |
 * | `robot` | 用不上 | 三款分区布局 |
 *
 * ## 三条通路与它们的优先级
 *
 * 原实现在 `changeWsData147` 里现读 `props.matrixName` 判分支
 * （`Num2D.jsx:645`、`Num2Doriginal.jsx:940`）。包里不该认识那串主应用的字符串，
 * 所以改成 `glove.enabled` / `foot.enabled` / `robot.enabled` 三个声明式开关，
 * **优先级 glove > foot > robot**，照抄两份原件的 if/else 次序。
 *
 * ## 与原实现的四处已知差异（都写明了为什么）
 *
 * 1. **`reportStats` 无条件先调。** 原实现的 `layoutData` 散在各分支里，
 *    `original` 变体在「三条通路一条都没开」时是不调的。本后端统一在
 *    `changeWsData147` 开头调一次 —— 内置预设没有一条会走到那个空分支
 *    （`webglRaw*` 里不开通路的那些都靠 `setRawFrame` 喂数据），所以现网无差异。
 * 2. **`u_useMask` 在建上下文时定死，不逐帧改。** 一个上下文要么是分区布局
 *    （建的时候 `withMask = true`）要么不是，原实现也是在 `initWebGL` 里
 *    一次性 `uniform1f`。
 * 3. **纹理上传统一走 `texData.fill(0)` + 按 `potW` 步长的两重循环**
 *    （`Num2Doriginal` 那份）。`Num2D` 那份是线性写、不清底，两者只在
 *    「帧长度小于纹理格数」时不同，而 `plain` 的四条喂数路径给出的长度**恒等于**
 *    纹理格数（256 / 36×36 / 16×32 / w×h），所以逐像素相同。
 * 4. **窗口 resize 时格子边长没变就不重建上下文。** `Num2D` 是无条件重建
 *    （销毁再造一个 WebGL 上下文），边长没变时那是纯浪费，画面一致。
 *
 * ## 只画 jet
 *
 * 片元着色器里只有一条 jet 阶梯（由 `glslJetLadder()` 从 `core/jetLadder.js`
 * 发码）。**选了别的配色，画面仍然是 jet** —— 两份原实现都写死 jet，照搬才不
 * 改观感。补齐的代价与做法见 `renderers/numMatrix/core/shaders.js` 顶部那段。
 */

import { addSide, gaussBlur_2 } from '../../../../core/frameMath.js';
import {
  FOOT_GRID_HEIGHT,
  FOOT_GRID_WIDTH,
  GLOVE_147_BASE,
  GLOVE_147_PADDED,
  GLOVE_147_THUMB_ROWS_WEBGL,
  applyFootPointLayout,
  applyGlove147Layout,
  calcCellSize,
  calcRobotCellSize,
  matrixViewportBounds,
  nextPOT,
  normalizeRawFrame,
  padGlove147Rows,
} from '../../core/layouts.js';
import { buildRobotFrame, getRobotLayout } from '../../core/robotLayouts.js';
import {
  QUAD_POSITIONS,
  QUAD_TEX_COORDS,
  VERTEX_SHADER_SRC,
  buildFragmentShader,
} from '../../core/shaders.js';
import {
  bindAttribBuffer,
  buildProgram,
  createLuminanceTexture,
  deleteGlResources,
  prewarmShaders,
  uploadLuminance,
} from '../../../shared/webgl/glUtil.js';

/** 上下文选项。两份原实现逐字相同 —— `preserveDrawingBuffer` 是给截图用的。 */
const GL_CONTEXT_OPTIONS = { antialias: false, preserveDrawingBuffer: true };

/** `changeWsData` 那条通路的高斯半径。两份原实现都写死 1。 */
const PLAIN_BLUR_RADIUS = 1;

/** resize 防抖窗口（ms）。两份原实现都是 200。 */
const RESIZE_DEBOUNCE_MS = 200;

/** 双脚版面时用来算格子边长的额外列数（两块 16 宽的图 + 2 列缝）。`Num2D.jsx:322`。 */
const DUAL_FOOT_GAP_CELLS = 2;

/**
 * 创建 WebGL 后端。
 *
 * 接口是 `canvas2d` 那一套再加一个 `setRawFrame`：
 *
 * - 必需：`setFrame` / `retint` / `start` / `dispose`；
 * - 可选：`commands`（4 个命令式方法）、`applyTuning`、`setRawFrame`。
 *
 * `coordinateLayout` / `onPeak` / `colormap` 三个入参收下但不用：原实现不读物理
 * 坐标表、不写峰值读数，配色见文件头「只画 jet」。
 *
 * @param {object} options 创建参数。
 * @param {HTMLElement} options.container 挂 canvas 的容器（`.canvasNum`）。
 * @param {object} options.config 归一化后的渲染器参数。
 * @param {{gridWidth: number, gridHeight: number}} options.grid 网格尺寸。
 * @param {object} [options.colormap] 当前配色（本后端不读，见文件头）。
 * @param {object} options.tuning 实例私有的阈值对象。
 * @param {(frame: number[], local?: boolean) => void} [options.reportStats] 回写侧栏统计。
 * @returns {object} 后端实例。
 */
export function createWebglMatrixBackend({
  container,
  config,
  grid,
  tuning,
  reportStats,
}) {
  const opts = config.webgl;

  // ---- 三条通路 ----
  const robotParts = opts.robot.enabled
    ? (opts.robot.parts || getRobotLayout(opts.robot.name))
    : null;
  const isRobot = Boolean(robotParts);
  const isFoot = opts.foot.enabled;
  const isGlove = opts.glove.enabled;

  // 片元着色器按两个编译期开关拼一次，之后所有上下文共用同一段源码。
  const fragmentSrc = buildFragmentShader({
    useMask: opts.useMask,
    whiteOnZero: opts.whiteOnZero,
  });
  prewarmShaders(VERTEX_SHADER_SRC, fragmentSrc);

  // ---- DOM ----
  // 逐条对应两份原实现的 JSX（`Num2D.jsx:803-858`、`Num2Doriginal.jsx:1147-1201`），
  // 差的两处已经收进下面两个常量：`original` 的外边距是 20px 且允许换行，
  // `plain` 是 40px 不换行。
  const stageMarginTop = opts.variant === 'original' ? '20px' : '40px';
  const stageFlexWrap = opts.variant === 'original' ? 'flex-wrap:wrap;' : '';

  const stage = document.createElement('div');
  stage.style.cssText = 'width:100%;height:100%;display:flex;'
    + 'justify-content:center;align-items:center;background-color:#fff;font-size:12px;';

  const row = document.createElement('div');
  row.className = 'threeBoxF';
  row.style.cssText = `position:relative;margin-top:${stageMarginTop};display:flex;`
    + `gap:10px;justify-content:center;align-items:flex-start;max-width:100%;${stageFlexWrap}`;

  /**
   * 建一组「热场 canvas + 叠加层 canvas + 脚别标签」。
   *
   * @param {string} label 标签文字；空串表示不建标签（非足底）。
   * @returns {{pane: HTMLElement, gl: HTMLCanvasElement, overlay: HTMLCanvasElement, label: HTMLElement|null}} 一组节点。
   */
  function createPane(label) {
    const pane = document.createElement('div');
    pane.style.cssText = 'position:relative;';
    const gl = document.createElement('canvas');
    gl.style.cssText = 'display:block;';
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    pane.appendChild(gl);
    pane.appendChild(overlay);
    let labelNode = null;
    if (label) {
      labelNode = document.createElement('div');
      labelNode.style.cssText = 'text-align:center;margin-top:4px;';
      labelNode.textContent = label;
      pane.appendChild(labelNode);
    }
    return { pane, gl, overlay, label: labelNode };
  }

  const paneA = createPane(isFoot ? '左脚' : '');
  const paneB = createPane(isFoot ? '右脚' : '');
  // 第二块在原实现里是条件挂载；这里常驻 DOM 用 display 切。两者等价 ——
  // 第二个上下文仍然只在版面变成 dual 时才建（见 `applyFootLayout`）。
  paneB.pane.style.display = 'none';
  row.appendChild(paneA.pane);
  if (isFoot) row.appendChild(paneB.pane);
  stage.appendChild(row);
  container.replaceChildren(stage);

  // ---- 实例状态（原实现的 14 个 ref + 2 个 React state）----
  let ctxA = null;
  let ctxB = null;
  let overlayA = null;
  let overlayB = null;
  let pendingA = null;
  let pendingB = null;
  let pendingRobot = null;
  let rafId = null;
  let started = false;
  let disposed = false;
  /** 最后一帧裸数据，`retintOnTuning` 用它重画。只有 `setRawFrame` 写它 —— 原实现如此。 */
  let lastData = null;
  let robotLayoutInfo = null;
  let footLayout = 'single-left';
  let lastLeftFrameAt = 0;
  let lastRightFrameAt = 0;

  const baseTexW = grid.gridWidth;
  const baseTexH = grid.gridHeight;
  let texSize = { w: baseTexW, h: baseTexH };

  /**
   * 视口可用宽高。**这是「渲染器按视口而非按容器定尺寸」那条积压的落点** ——
   * 换成容器尺寸只要改这一个函数，`matrixViewportBounds` 的公式不用动。
   *
   * @returns {{maxW: number, maxH: number}} 可用宽高。
   */
  function bounds() {
    return matrixViewportBounds({
      innerWidth: globalThis.innerWidth,
      innerHeight: globalThis.innerHeight,
      widthRatio: isRobot ? opts.robot.widthRatio : opts.widthRatio,
    });
  }

  /**
   * 算格子边长。
   *
   * 三条互斥的口径，逐条对应原实现的 `computeCellSize`：分区布局按拼好的
   * 布局尺寸算（首帧之前用 40×10 估）、`fixedCellSize` 写死（`original` 的足底）、
   * 其余按传进来的尺寸算。
   *
   * ⚠️ **传进来的通常不是当前纹理尺寸，而是「产品尺寸」**：手套的纹理会在
   * `changeWsData147` 里涨到 36×36，但原实现重算边长时用的仍然是 16×16。
   * 只有 `refitOnSizeChange` 那条路才按新纹理尺寸算。
   *
   * @param {number} [texW=baseTexW] 参考宽（格）。
   * @param {number} [texH=baseTexH] 参考高（格）。
   * @returns {number} 格子边长（px）。
   */
  function computeCellSize(texW = baseTexW, texH = baseTexH) {
    const { maxW, maxH } = bounds();
    if (isRobot) {
      const info = robotLayoutInfo || { layoutW: 40, layoutH: 10 };
      return calcRobotCellSize(info.layoutW, info.layoutH, maxW, maxH);
    }
    if (opts.fixedCellSize > 0) return opts.fixedCellSize;
    return calcCellSize(texW, texH, maxW, maxH, opts.cellPadding);
  }

  /**
   * 重算边长时用的参考尺寸。双脚版面要按「两块并排」算，不然右脚会挤出可视区。
   *
   * @param {boolean} dual 是否双脚版面。
   * @returns {[number, number]} 参考宽高（格）。
   */
  function sizingSize(dual) {
    if (isFoot && dual) return [opts.foot.width * 2 + DUAL_FOOT_GAP_CELLS, opts.foot.height];
    return [baseTexW, baseTexH];
  }

  let cellSize = computeCellSize();

  // ---- WebGL 上下文 ----

  /**
   * 建一个 WebGL 上下文并把两张纹理、两个 buffer、四个 uniform 都备好。
   *
   * 合并自两份原实现的 `initWebGL`。`potTexture` 关掉时纹理尺寸就是矩阵尺寸、
   * `u_texScale` 传 `(1,1)` —— 乘 1 是恒等变换，与 `Num2D` 那份没有这个 uniform
   * 的写法逐像素相同（见 `shaders.js` 顶部）。
   *
   * @param {HTMLCanvasElement} canvas 目标画布。
   * @param {number} texWidth 矩阵宽（格）。
   * @param {number} texHeight 矩阵高（格）。
   * @param {number} cs 格子边长（px）。
   * @param {boolean} withMask 是否建 mask 纹理（只有分区布局要）。
   * @returns {object|null} 上下文包；拿不到 WebGL 时 `null`（画面空白，不抛）。
   */
  function initContext(canvas, texWidth, texHeight, cs, withMask) {
    const cw = texWidth * cs;
    const ch = texHeight * cs;
    canvas.width = cw;
    canvas.height = ch;

    const potW = opts.potTexture ? nextPOT(texWidth) : texWidth;
    const potH = opts.potTexture ? nextPOT(texHeight) : texHeight;

    const gl = canvas.getContext('webgl', GL_CONTEXT_OPTIONS);
    if (!gl) return null;
    const built = buildProgram(gl, VERTEX_SHADER_SRC, fragmentSrc);
    if (!built) return null;
    const { program, vs, fs } = built;
    gl.useProgram(program);

    const posBuffer = bindAttribBuffer(gl, program, 'a_position', QUAD_POSITIONS);
    const texBuffer = bindAttribBuffer(gl, program, 'a_texCoord', QUAD_TEX_COORDS);

    const { texture, data: texData } = createLuminanceTexture(gl, 0, potW, potH);
    let maskTexture = null;
    let maskData = null;
    if (withMask) {
      const mask = createLuminanceTexture(gl, 1, potW, potH);
      maskTexture = mask.texture;
      maskData = mask.data;
    }

    const uMin = gl.getUniformLocation(program, 'u_min');
    const uMax = gl.getUniformLocation(program, 'u_max');
    gl.uniform1f(uMin, 0);
    gl.uniform1f(uMax, 40);
    gl.uniform1i(gl.getUniformLocation(program, 'u_data'), 0);
    if (opts.useMask) {
      gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 1);
      // 一个上下文要么一直带掩码要么一直不带，所以这里定死，不逐帧改。
      gl.uniform1f(gl.getUniformLocation(program, 'u_useMask'), withMask ? 1 : 0);
    }
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_texScale'),
      texWidth / potW,
      texHeight / potH,
    );
    gl.viewport(0, 0, cw, ch);

    return {
      gl, program, vs, fs, posBuffer, texBuffer,
      texture, texData, maskTexture, maskData,
      uMin, uMax, potW, potH, texWidth, texHeight,
    };
  }

  /**
   * 释放一个上下文包。
   *
   * @param {object|null} ctx `initContext` 的返回值。
   */
  function destroyContext(ctx) {
    if (!ctx) return;
    deleteGlResources(ctx.gl, {
      program: ctx.program,
      vs: ctx.vs,
      fs: ctx.fs,
      textures: [ctx.texture, ctx.maskTexture],
      buffers: [ctx.posBuffer, ctx.texBuffer],
    });
  }

  /**
   * 按矩阵尺寸把叠加层画布调好并取 2d 上下文。
   *
   * @param {HTMLCanvasElement} canvas 叠加层画布。
   * @param {number} texWidth 矩阵宽（格）。
   * @param {number} texHeight 矩阵高（格）。
   * @param {number} cs 格子边长（px）。
   * @returns {CanvasRenderingContext2D} 2d 上下文。
   */
  function sizeOverlay(canvas, texWidth, texHeight, cs) {
    canvas.width = texWidth * cs + opts.overlayPad;
    canvas.height = texHeight * cs + opts.overlayPad;
    return canvas.getContext('2d');
  }

  /**
   * 重建主上下文。
   *
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   * @param {boolean} [withMask=false] 是否带掩码。
   */
  function rebuildPrimary(tw, th, withMask = false) {
    texSize = { w: tw, h: th };
    destroyContext(ctxA);
    ctxA = initContext(paneA.gl, tw, th, cellSize, withMask);
    overlayA = sizeOverlay(paneA.overlay, tw, th, cellSize);
  }

  /**
   * 重建第二块（右脚）上下文。
   *
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   */
  function rebuildSecondary(tw, th) {
    destroyContext(ctxB);
    ctxB = initContext(paneB.gl, tw, th, cellSize, false);
    overlayB = sizeOverlay(paneB.overlay, tw, th, cellSize);
  }

  /**
   * 换纹理尺寸。合并自 `Num2D` 的 `reinitGL` 与 `Num2Doriginal` 的
   * `ensureFlatMatrixSize`，两者的**唯一**区别就是后者会顺带重算格子边长
   * （`refitOnSizeChange`）。不统一 —— 统一就是改画面。
   *
   * @param {number} tw 新矩阵宽（格）。
   * @param {number} th 新矩阵高（格）。
   */
  function ensureTextureSize(tw, th) {
    if (texSize.w === tw && texSize.h === th && ctxA) return;
    if (opts.refitOnSizeChange) cellSize = computeCellSize(tw, th);
    rebuildPrimary(tw, th, false);
  }

  // ---- 上屏 ----

  /**
   * 把一帧填进 POT 纹理并上传，顺带定色标上限。
   *
   * @param {object} ctx 上下文包。
   * @param {ArrayLike<number>} data 帧数据。
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   * @param {number} [maxOverride] 色标上限；非正数时取帧内最大值。
   */
  function uploadFrame(ctx, data, tw, th, maxOverride) {
    const { gl, texture, texData, potW, potH, uMin, uMax } = ctx;
    texData.fill(0);
    let maxVal = 0;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const src = y * tw + x;
        const v = src < data.length
          ? Math.min(255, Math.max(0, Math.round(data[src])))
          : 0;
        texData[y * potW + x] = v;
        if (v > maxVal) maxVal = v;
      }
    }
    const dynamicMax = (maxOverride && maxOverride > 0) ? maxOverride : Math.max(maxVal, 1);
    gl.uniform1f(uMin, 0);
    gl.uniform1f(uMax, dynamicMax);
    uploadLuminance(gl, 0, texture, texData, potW, potH);
  }

  /**
   * 画一帧规则网格。
   *
   * `maxFromThreshold` 打开时色标上限走 `valuej1`（拖颜色滑块会变），关掉时恒取
   * 帧内最大值。**分区布局永远不看它** —— 原实现的 `renderRobotWebGL` 没有这个
   * 入参，照抄。
   *
   * @param {object|null} ctx 上下文包。
   * @param {ArrayLike<number>} data 帧数据。
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   */
  function renderFrame(ctx, data, tw, th) {
    if (!ctx) return;
    const maxOverride = opts.maxFromThreshold && tuning.valuej1 > 0 ? tuning.valuej1 : undefined;
    uploadFrame(ctx, data, tw, th, maxOverride);
    ctx.gl.drawArrays(ctx.gl.TRIANGLES, 0, 6);
  }

  /**
   * 画一帧分区布局（数据纹理 + 掩码纹理，一次 draw call 画完所有分区）。
   *
   * @param {object|null} ctx 上下文包。
   * @param {ArrayLike<number>} layout 拼好的布局数据。
   * @param {ArrayLike<number>} mask 掩码。
   * @param {number} tw 布局宽（格）。
   * @param {number} th 布局高（格）。
   */
  function renderRobotFrame(ctx, layout, mask, tw, th) {
    if (!ctx) return;
    uploadFrame(ctx, layout, tw, th, undefined);
    if (ctx.maskTexture && mask) {
      const { maskData, potW, potH } = ctx;
      maskData.fill(0);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const src = y * tw + x;
          maskData[y * potW + x] = src < mask.length ? mask[src] : 0;
        }
      }
      uploadLuminance(ctx.gl, 1, ctx.maskTexture, maskData, potW, potH);
    }
    ctx.gl.drawArrays(ctx.gl.TRIANGLES, 0, 6);
  }

  /**
   * 画叠加层：网格线 + 每格数字 +（可选）底部列号带。
   *
   * 合并自两份原实现的 `drawOverlay`，差异全在参数里：线色、0 值字色、列号带。
   *
   * @param {CanvasRenderingContext2D|null} ctx2d 叠加层上下文。
   * @param {ArrayLike<number>} data 帧数据。
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   * @param {number} cs 格子边长（px）。
   */
  function paintOverlay(ctx2d, data, tw, th, cs) {
    if (!ctx2d) return;
    const cw = tw * cs;
    const ch = th * cs;
    ctx2d.clearRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);

    if (opts.showBorder) {
      ctx2d.strokeStyle = opts.gridColor;
      ctx2d.lineWidth = 1;
      for (let i = 0; i <= th; i++) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, i * cs);
        ctx2d.lineTo(cw, i * cs);
        ctx2d.stroke();
      }
      for (let j = 0; j <= tw; j++) {
        ctx2d.beginPath();
        ctx2d.moveTo(j * cs, 0);
        ctx2d.lineTo(j * cs, ch);
        ctx2d.stroke();
      }
    }

    if (opts.showNumbers) {
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `bold ${Math.max(10, cs * 0.45)}px monospace`;
      const len = Math.min(data.length, tw * th);
      for (let i = 0; i < th; i++) {
        for (let j = 0; j < tw; j++) {
          const idx = i * tw + j;
          const val = idx < len ? Math.round(data[idx]) : 0;
          ctx2d.fillStyle = (val === 0 && opts.zeroTextColor) ? opts.zeroTextColor : opts.textColor;
          ctx2d.fillText(val.toString(), j * cs + cs / 2, i * cs + cs / 2);
        }
      }
    }

    if (opts.indexRow) {
      const rowY = ch;
      const rowH = Math.max(cs * 0.7, 18);
      ctx2d.fillStyle = opts.indexRowColor;
      ctx2d.fillRect(0, rowY, cw, rowH);
      ctx2d.fillStyle = opts.textColor;
      ctx2d.font = `bold ${Math.max(8, cs * 0.35)}px monospace`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      for (let j = 0; j < tw; j++) {
        ctx2d.fillText(j.toString(), j * cs + cs / 2, rowY + rowH / 2);
      }
    }
  }

  /**
   * 画分区布局的叠加层：每块自己的网格线、数字与下方标题。
   *
   * @param {CanvasRenderingContext2D|null} ctx2d 叠加层上下文。
   * @param {Array<object>} partDefs 带偏移的分区表。
   * @param {number} cs 格子边长（px）。
   */
  function paintRobotOverlay(ctx2d, partDefs, cs) {
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);
    const fontSize = Math.max(10, cs * 0.45);
    const titleFontSize = Math.max(10, cs * 0.5);

    partDefs.forEach((def) => {
      const { offsetX, offsetY, w, h, data, text } = def;
      const px = offsetX * cs;
      const py = offsetY * cs;
      const pw = w * cs;
      const ph = h * cs;

      ctx2d.strokeStyle = opts.gridColor;
      ctx2d.lineWidth = 1;
      for (let i = 0; i <= h; i++) {
        ctx2d.beginPath();
        ctx2d.moveTo(px, py + i * cs);
        ctx2d.lineTo(px + pw, py + i * cs);
        ctx2d.stroke();
      }
      for (let j = 0; j <= w; j++) {
        ctx2d.beginPath();
        ctx2d.moveTo(px + j * cs, py);
        ctx2d.lineTo(px + j * cs, py + ph);
        ctx2d.stroke();
      }

      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `bold ${fontSize}px monospace`;
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          const idx = i * w + j;
          const val = idx < data.length ? Math.round(data[idx]) : 0;
          ctx2d.fillStyle = (val === 0 && opts.zeroTextColor) ? opts.zeroTextColor : opts.textColor;
          ctx2d.fillText(val.toString(), px + j * cs + cs / 2, py + i * cs + cs / 2);
        }
      }

      ctx2d.fillStyle = opts.titleColor;
      ctx2d.font = `bold ${titleFontSize}px sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(text, px + pw / 2, py + ph + 4);
    });
  }

  /** 排一次 RAF。已经排了就不重复排 —— 高频推帧时只画最后一帧。 */
  function schedule() {
    if (rafId !== null || disposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!started || disposed) return;
      const cs = cellSize;

      if (!isRobot && pendingA !== null) {
        const { data, tw, th } = pendingA;
        pendingA = null;
        renderFrame(ctxA, data, tw, th);
        paintOverlay(overlayA, data, tw, th, cs);
      }

      if (pendingB !== null && ctxB) {
        const { data, tw, th } = pendingB;
        pendingB = null;
        renderFrame(ctxB, data, tw, th);
        paintOverlay(overlayB, data, tw, th, cs);
      }

      if (isRobot && pendingRobot !== null && ctxA) {
        const { layoutData, maskData, layoutW, layoutH, partDefsWithOffset } = pendingRobot;
        pendingRobot = null;
        renderRobotFrame(ctxA, layoutData, maskData, layoutW, layoutH);
        paintRobotOverlay(overlayA, partDefsWithOffset, cs);
      }
    });
  }

  /**
   * 交一帧给主画布。
   *
   * @param {ArrayLike<number>} data 帧数据。
   * @param {number} tw 矩阵宽（格）。
   * @param {number} th 矩阵高（格）。
   */
  function queuePrimary(data, tw, th) {
    pendingA = { data, tw, th };
    schedule();
  }

  // ---- 足底的单/双脚状态机（本后端唯一一处运行期状态机）----

  /**
   * 版面变了：切第二块的可见性、改标签、重算边长、按需重建上下文。
   *
   * 对应两份原实现的 `footLayout` 副作用（`Num2D.jsx:424-459`、
   * `Num2Doriginal.jsx:702-721`）。`original` 的边长是写死的 30，所以那一份走到
   * 这里恒不重建主上下文，只会懒建第二块。
   *
   * @param {string} layout `'single-left' | 'single-right' | 'dual'`。
   */
  function applyFootLayout(layout) {
    const dual = layout === 'dual';
    paneB.pane.style.display = dual ? '' : 'none';
    if (paneA.label) paneA.label.textContent = layout === 'single-right' ? '右脚' : '左脚';

    const [sw, sh] = sizingSize(dual);
    const newCs = computeCellSize(sw, sh);
    const changed = newCs !== cellSize;
    if (changed) cellSize = newCs;

    if (changed || !ctxA) rebuildPrimary(opts.foot.width, opts.foot.height, false);
    if (dual && (changed || !ctxB)) rebuildSecondary(opts.foot.width, opts.foot.height);
    if (dual && pendingB) schedule();
  }

  /**
   * 收到某一侧的帧，更新单/双脚版面。
   *
   * 谁在 `foot.ttlMs` 窗口内来过帧谁就算「在线」，两条都在线才铺双脚。
   *
   * @param {string} side `'left'` 或 `'right'`。
   * @returns {string} 更新后的版面。
   */
  function syncFootLayout(side) {
    if (!isFoot) return footLayout;
    const now = Date.now();
    const ttl = opts.foot.ttlMs;
    if (side === 'left') lastLeftFrameAt = now;
    if (side === 'right') lastRightFrameAt = now;

    const leftActive = now - lastLeftFrameAt < ttl;
    const rightActive = now - lastRightFrameAt < ttl;
    const next = leftActive && rightActive ? 'dual' : (rightActive ? 'single-right' : 'single-left');

    if (footLayout !== next) {
      footLayout = next;
      applyFootLayout(next);
    }
    return next;
  }

  /**
   * 把一侧的足底帧交给指定画布。
   *
   * `interp` 模式先把 60 个采样点散进 16×32 再双向插值，`raw` 模式原样上屏。
   *
   * @param {number[]} wsData 该侧的原始帧。
   * @param {string} target `'primary'` 或 `'secondary'`。
   */
  function queueFootFrame(wsData, target) {
    const frame = opts.foot.mode === 'interp'
      ? applyFootPointLayout(wsData)
      : [...wsData];
    // `interp` 的点表写死 16×32，预设里的 foot.width/height 与它一致。
    const tw = opts.foot.mode === 'interp' ? FOOT_GRID_WIDTH : opts.foot.width;
    const th = opts.foot.mode === 'interp' ? FOOT_GRID_HEIGHT : opts.foot.height;

    if (target === 'secondary') {
      if (!ctxB) rebuildSecondary(tw, th);
      pendingB = { data: frame, tw, th };
      schedule();
      return;
    }
    ensureTextureSize(tw, th);
    queuePrimary(frame, tw, th);
  }

  // ---- 分区布局 ----

  /**
   * 一帧 256 点原始数据 → 分区纹理。布局尺寸变了才重建上下文。
   *
   * @param {number[]} wsPointData 原始帧。
   */
  function processRobot(wsPointData) {
    const built = buildRobotFrame(wsPointData, robotParts, opts.robot.gap);
    const { layoutW, layoutH } = built;
    if (!robotLayoutInfo || robotLayoutInfo.layoutW !== layoutW || robotLayoutInfo.layoutH !== layoutH) {
      robotLayoutInfo = { layoutW, layoutH };
      cellSize = computeCellSize();
      rebuildPrimary(layoutW, layoutH, true);
    }
    pendingRobot = built;
    schedule();
  }

  // ---- 窗口 resize ----

  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (disposed) return;
      const dual = footLayout === 'dual';
      const [sw, sh] = sizingSize(dual);
      const newCs = computeCellSize(sw, sh);
      // 原实现无条件重建上下文；边长没变时那是纯浪费，画面一致。
      if (newCs === cellSize) return;
      cellSize = newCs;

      if (isRobot) {
        if (robotLayoutInfo && ctxA) {
          rebuildPrimary(robotLayoutInfo.layoutW, robotLayoutInfo.layoutH, true);
        }
      } else if (ctxA) {
        rebuildPrimary(texSize.w, texSize.h, false);
      }
      if (isFoot && dual && ctxB) rebuildSecondary(opts.foot.width, opts.foot.height);
    }, RESIZE_DEBOUNCE_MS);
  }
  globalThis.addEventListener?.('resize', handleResize);

  // ---- 挂载 ----

  // 分区布局不在这里建上下文：布局尺寸要等第一帧到了才知道（原实现同此）。
  if (!isRobot) {
    rebuildPrimary(baseTexW, baseTexH, false);
  }

  // 整包手套上电到第一帧之间有好几秒，不先铺一张空网格那段时间是纯白，像坏了。
  if (opts.glovePrimeOnMount) {
    const primed = new Array(opts.glove.width * opts.glove.height).fill(0);
    reportStats?.(primed);
    queuePrimary(primed, opts.glove.width, opts.glove.height);
  }

  const commands = {
    /**
     * 147 点手套 / 足底 / 分区布局三选一。
     *
     * `reportStats` 无条件先调，与原实现的差异见文件头第 1 条。
     *
     * @param {number[]} wsPointData 原始帧。
     */
    changeWsData147(wsPointData) {
      if (!Array.isArray(wsPointData)) return;
      reportStats?.(wsPointData.slice());

      if (isGlove) {
        if (opts.glove.mode === 'scatter32') {
          const laid = applyGlove147Layout(wsPointData, {
            thumbRowOffsets: GLOVE_147_THUMB_ROWS_WEBGL,
          });
          const padded = addSide(laid, GLOVE_147_BASE, GLOVE_147_BASE, 2, 2, 0);
          ensureTextureSize(GLOVE_147_PADDED, GLOVE_147_PADDED);
          queuePrimary(padded, GLOVE_147_PADDED, GLOVE_147_PADDED);
          return;
        }
        // `rows15`：整包手套补到 15×13，其余在第 75 位补三个 0 成 15×10。
        // 「是不是整包」由预设的 `glove.height` 声明（13 = 整包），不再读矩阵名。
        const { data, gridWidth, gridHeight } = padGlove147Rows(wsPointData, {
          fullPacket: opts.glove.height >= 13,
        });
        ensureTextureSize(gridWidth, gridHeight);
        queuePrimary(data, gridWidth, gridHeight);
        return;
      }

      if (isFoot) {
        queueFootFrame(wsPointData, 'primary');
        return;
      }

      if (isRobot) processRobot(wsPointData);
    },

    /**
     * 左右两侧分开推的通路。手套原样转给 `changeWsData147`，足底走双画布。
     *
     * 版面判定必须在排帧**之前**：`syncFootLayout` 可能会改格子边长并重建上下文，
     * 排帧时才好按新边长建第二块。
     *
     * @param {{left?: number[], right?: number[]}} wsPointData 两侧的帧。
     */
    changeWsData147R(wsPointData) {
      if (isGlove) {
        commands.changeWsData147(wsPointData);
        return;
      }
      if (!isFoot || !wsPointData) return;
      const { left, right } = wsPointData;

      if (Array.isArray(left)) {
        syncFootLayout('left');
        reportStats?.([...left]);
        queueFootFrame(left, 'primary');
      }

      if (Array.isArray(right)) {
        const layout = syncFootLayout('right');
        const target = layout === 'dual' ? 'secondary' : 'primary';
        // 双脚时右脚不驱动侧栏 —— 侧栏只有一套读数，原实现把它留给左脚。
        if (target === 'primary') reportStats?.([...right]);
        queueFootFrame(right, target);
      }
    },

    /**
     * 手套原始 256 点，按 16×16 直接上屏。
     *
     * @param {number[]} wsPointData 原始帧。
     */
    changeWsData256(wsPointData) {
      if (!Array.isArray(wsPointData)) return;
      let raw = [...wsPointData];
      if (raw.length > 256) raw = raw.slice(0, 256);
      while (raw.length < 256) raw.push(0);
      reportStats?.([...raw]);
      ensureTextureSize(16, 16);
      queuePrimary(raw, 16, 16);
    },

    /** 原实现就是空函数体。保留是因为 `components/foot/Car.jsx:380` 在调它。 */
    drawContent() {},
  };

  return {
    /**
     * 常规通道：shell 已经按 `valuef1` 过滤过，这里补总量守卫与高斯模糊。
     *
     * ⚠️ 总量不足时填的是 **1 不是 0**（两份原实现都这样，模糊完是一片均匀的
     * 底色而不是纯黑）。
     *
     * **这条通路全仓一个调用方都没有**（`changeWsData` 从来没被调过），
     * 搬过来是因为契约取暴露面的并集。
     *
     * @param {number[]} nextFrame 已过滤的帧。
     */
    setFrame(nextFrame) {
      if (!Array.isArray(nextFrame)) return;
      let data = nextFrame;
      if (data.reduce((a, b) => a + b, 0) < tuning.valuelInit1) {
        data = new Array(baseTexW * baseTexH).fill(1);
      }
      ensureTextureSize(baseTexW, baseTexH);
      queuePrimary(gaussBlur_2(data, baseTexW, baseTexH, PLAIN_BLUR_RADIUS), baseTexW, baseTexH);
    },

    /**
     * 裸数据通路：不过滤、不模糊，按需转置后直接上屏。
     *
     * shell 的 `changeWsDataRaw` 认这个方法；后端不实现它时 shell 退回 `sitData`。
     *
     * @param {number[]} wsPointData 原始帧。
     */
    setRawFrame(wsPointData) {
      const rawData = normalizeRawFrame(wsPointData, {
        transpose: opts.rawTranspose,
        width: baseTexW,
        height: baseTexH,
      });
      lastData = rawData;
      reportStats?.([...rawData]);
      queuePrimary(rawData, baseTexW, baseTexH);
    },

    /**
     * 契约要求的重着色钩子，本后端是**空实现**。
     *
     * 原实现把「拖滑块重画一帧」写在 `sitValue` 末尾，且门槛是
     * `if (valuej || valuef)` 的真值判断 —— shell 的 `retint()` 只在 `valuej`
     * 变化时调，条件对不上。所以真正的重画在 `applyTuning` 里，这里留空，
     * 免得同一次调参画两遍。
     */
    retint() {},

    /**
     * 吸收阈值变化。逐字对应 `Num2Doriginal.jsx:839-851`。
     *
     * 三重门槛缺一不可：变的是 `valuej` 或 `valuef`（真值判断，0 不算）、
     * 当前没有在途帧、有过裸数据帧。尺寸取的是**上下文自己记的**纹理尺寸，
     * 不是 `texSize` —— 两者在换尺寸失败时会不一致。
     *
     * @param {object} [changed] `sitValue` 收到的那个对象。
     */
    applyTuning(changed = {}) {
      if (!opts.retintOnTuning) return;
      if (!(changed.valuej || changed.valuef)) return;
      if (pendingA !== null || !ctxA || !lastData) return;
      queuePrimary(lastData, ctxA.texWidth, ctxA.texHeight);
    },

    /** 启动。没有常驻帧循环 —— 有数据才画，所以这里只是开闸。 */
    start() {
      if (disposed) return;
      started = true;
      if (pendingA !== null || pendingB !== null || pendingRobot !== null) schedule();
    },

    /** 释放：停 RAF、摘 resize 监听、删两套 GPU 资源、清空容器。 */
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      globalThis.removeEventListener?.('resize', handleResize);
      clearTimeout(resizeTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      pendingA = null;
      pendingB = null;
      pendingRobot = null;
      lastData = null;
      destroyContext(ctxA);
      destroyContext(ctxB);
      ctxA = null;
      ctxB = null;
      overlayA = null;
      overlayB = null;
      container.replaceChildren();
    },

    commands,
  };
}

/**
 * 本后端往 ref 上多挂的方法名。
 *
 * 这 4 个必须全部在 `core/contract.js` 的 `RENDERER_METHODS` 里，否则
 * `registerRenderer` 会**静默拒绝注册**（返回 false，不抛错），现象是白屏。
 * 四个都是第 1 批就已经在册的，本批不用再动契约。
 */
createWebglMatrixBackend.commandNames = [
  'changeWsData147',
  'changeWsData147R',
  'changeWsData256',
  'drawContent',
];

export default createWebglMatrixBackend;
