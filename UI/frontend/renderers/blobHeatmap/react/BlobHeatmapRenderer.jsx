/**
 * renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx - 斑点热力（Canvas 2D）
 *
 * 搬自 `client/src/components/heatmap/canvas.jsx`（460 行，导出名 `Heatmap`）。
 * 画法：每个数据点画一个带阴影的圆，按 alpha 分桶叠加，再把整块 `ImageData` 的
 * alpha 当索引查一条 256 级渐变调色板着色。调色板在
 * `renderers/blobHeatmap/core/intensity.js`，帧运算在 `renderers/blobHeatmap/core/pipeline.js`。
 *
 * ## 搬的时候处理掉的四件事（前三件**可证明画面不变**）
 *
 * 1. **模块级可变状态**。原件把 `data` / `options` / `isShadow` / `canvas` /
 *    `context` 和四个阈值都声明在**模块顶层**（`canvas.jsx:9-22`）—— 违反渲染器
 *    契约第 2 条，同页挂两块会互相覆盖，而且挂过一次 `carCol` 之后 `options.max`
 *    就永久变成 300（下一个实例跟着串味）。全部收进 `stateRef`。
 * 2. **`document.getElementById('heatmapcanvas')`**。写死的 id + 全局查询，同页
 *    第二块必然抢同一个元素。换成 `useRef`。
 * 3. **50 行死运算**（旋转 / 过滤 / 插值 / 补边 / 高斯模糊，结果没人读）与
 *    **每像素一次的 `const value = jet()` 空调用**。详见
 *    `renderers/blobHeatmap/core/pipeline.js` 与 `intensity.js` 的文件头。
 * 4. **`new Array(1024).fill(0)`** 写死 1024，与 `carCol` 的 10×9=90 对不上 ——
 *    它属于第 3 条那段死码，一起走了。
 *
 * ## 两处**行为修正**（明说）
 *
 * 原件每帧 `new Intensity()`，也就是每帧新建一张 256×1 画布、画一遍渐变、
 * `getImageData` 读回来。这里调色板只建一次。像素完全相同（同一组色标、同一条
 * `createLinearGradient`），差别只在不再每帧重算。
 *
 * 原件铺点时把行下标用于 X、列下标用于 Y，非方阵会转置并越界。SDK 改为
 * `x = column`、`y = row`，与其他常规矩阵渲染器共享 row-major 显示方向。
 *
 * ## ⚠️ 那四个滑块本来就不起作用
 *
 * `valueg` / `valuel` / `valuef` / `valuelInit` 在原件里只喂给上面第 3 条那段
 * 死运算，对画面零影响。搬进包之后仍然零影响（界面零变化是这一轮的硬约束）。
 * `sitValue` 照收照存，宿主的调用点不用改。
 */

import React, {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef,
} from 'react';

import {
  colorize,
  createIntensity,
} from '../core/intensity.js';
import { normalizeBlobHeatmapParams } from '../core/params.js';
import {
  buildBlobPoints,
  frameStats,
  groupByAlpha,
} from '../core/pipeline.js';
import { useDeclarativeFrame } from '../../shared/react/useDeclarativeFrame.js';

/**
 * 画一个带阴影的圆，返回离屏画布。
 *
 * 逐字搬自 `canvas.jsx:147-164`，包括那个 `offsetDistance = 10000` 的把戏：
 * 圆心画在画布外一万像素处，只让**阴影**落在画布里 —— 于是拿到的是一团纯粹的
 * 径向羽化，没有实心边。
 *
 * @param {number} size 半径。
 * @param {boolean} shadow 要不要阴影（不要就是一个硬边圆，但圆心在画布外，
 *   实际什么都画不出来 —— 原件的 `isShadow=false` 分支从没被走到过）。
 * @returns {HTMLCanvasElement} 圆点贴图。
 */
function createCircle(size, shadow) {
  const shadowBlur = size / 2;
  const r2 = size + shadowBlur;
  const offsetDistance = 10000;

  const circle = document.createElement('canvas');
  circle.width = r2 * 2;
  circle.height = r2 * 2;
  const ctx = circle.getContext('2d');

  if (shadow) ctx.shadowBlur = shadowBlur;
  ctx.shadowColor = 'black';
  ctx.shadowOffsetX = offsetDistance;
  ctx.shadowOffsetY = offsetDistance;

  ctx.beginPath();
  ctx.arc(r2 - offsetDistance, r2 - offsetDistance, size, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();
  return circle;
}

const BlobHeatmapRenderer = React.forwardRef(function BlobHeatmapRenderer(props, refs) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const params = useMemo(
    () => normalizeBlobHeatmapParams(props.params),
    [props.params],
  );
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const stateRef = useRef({
    /** 侧栏能改的那两个（`max` 真的起作用，`radius` 原件没暴露改法）。 */
    cfg: { max: params.max, radius: params.radius },
    /**
     * 那四个不起作用的。存着只为让 `sitValue` 有个去处 —— 见文件头。
     */
    inert: { valueg: null, valuel: null, valuef: null, valuelInit: null },
    circle: null,
    circleKey: null,
    intensity: null,
    lastFrame: null,
  });

  useEffect(() => {
    stateRef.current.cfg = { max: params.max, radius: params.radius };
    // 色标换了就得重建调色板。
    stateRef.current.intensity = null;
    stateRef.current.circle = null;
  }, [params.max, params.radius, params.gradient]);

  /** 拿（或建）圆点贴图与调色板，两者都只依赖参数。 */
  const ensureAssets = useCallback(() => {
    const state = stateRef.current;
    const current = paramsRef.current;
    const key = `${state.cfg.radius}:${current.shadow}`;
    if (!state.circle || state.circleKey !== key) {
      state.circle = createCircle(state.cfg.radius, current.shadow);
      state.circleKey = key;
    }
    if (!state.intensity) {
      state.intensity = createIntensity(
        current.gradient ? { gradient: current.gradient } : {},
      );
    }
    return state;
  }, []);

  /**
   * 画一帧。
   *
   * @param {number[]} values 一帧原始数据。
   * @returns {void}
   */
  const paint = useCallback((values) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const current = paramsRef.current;
    const state = ensureAssets();
    const { circle, intensity } = state;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const points = buildBlobPoints(
      values, current.dataWidth, current.dataHeight, canvas.width, canvas.height,
    );
    const halfWidth = circle.width / 2;
    const halfHeight = circle.height / 2;

    groupByAlpha(points, state.cfg.max).forEach((bucket) => {
      if (Number.isNaN(Number(bucket.alpha))) return;
      ctx.beginPath();
      ctx.globalAlpha = bucket.alpha;
      bucket.points.forEach((point) => {
        ctx.drawImage(circle, point.x - halfWidth, point.y - halfHeight);
      });
    });

    const colored = ctx.getImageData(0, 0, canvas.width, canvas.height);
    colorize(colored.data, intensity.getImageData(), {
      max: state.cfg.max,
      min: current.min,
      maxOpacity: current.maxOpacity,
      alphaFloor: current.alphaFloor,
    });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 底色 #666 是原件写死的，热区之外看到的就是它。
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(colored, 0, 0);
  }, [ensureAssets]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    function resizeCanvas() {
      const width = Math.max(1, container.clientWidth || window.innerWidth);
      const height = Math.max(1, container.clientHeight || window.innerHeight);
      const availableSide = Math.min(width, height);
      const side = Math.max(1, Math.min(
        availableSide,
        Math.round(availableSide * params.canvasScale),
      ));
      if (canvas.width === side && canvas.height === side) return;
      canvas.width = side;
      canvas.height = side;
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
      if (stateRef.current.lastFrame) paint(stateRef.current.lastFrame);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(container);
    }
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      resizeObserver?.disconnect();
    };
  }, [paint, params.canvasScale]);

  /** 把读数推给宿主。原件没有这一步，宿主不传 `data` 就整段不执行。 */
  const publishStats = useCallback((values) => {
    if (!props.data?.current?.changeData) return;
    props.data.current.changeData(frameStats(values));
  }, [props.data]);

  /**
   * 收一帧并立刻画。原件的主入口就是它（**没有 `sitData`**）。
   *
   * @param {number[]} values 一帧数据。
   * @returns {HTMLCanvasElement | null} 画布，供导出用。
   */
  const bthClickHandle = useCallback((values) => {
    const list = Array.isArray(values) ? values : [];
    stateRef.current.lastFrame = list;
    paint(list);
    publishStats(list);
    return canvasRef.current;
  }, [paint, publishStats]);

  /**
   * 收一帧（契约里的标准入口）。转调 `bthClickHandle` —— 原件没有这个方法，
   * 补上是为了让宿主用同一套 `sitData({ wsPointData })` 喂四个渲染器。
   *
   * @param {{wsPointData?: number[]}} prop 帧。
   * @returns {void}
   */
  const sitData = useCallback((prop) => {
    const values = prop?.wsPointData;
    if (!Array.isArray(values) || values.length === 0) return;
    bthClickHandle(values);
  }, [bthClickHandle]);

  /**
   * 侧栏滑块。⚠️ 六个键里只有 `valuej` 真的改画面，另外四个见文件头。
   *
   * @param {object} prop 调参。
   * @returns {void}
   */
  const sitValue = useCallback((prop) => {
    if (!prop) return;
    const { valuej, valueg, valuel, valuef, valuelInit } = prop;
    if (valuej) stateRef.current.cfg.max = valuej;
    if (valueg) stateRef.current.inert.valueg = valueg;
    if (valuel) stateRef.current.inert.valuel = valuel;
    if (valuef) stateRef.current.inert.valuef = valuef;
    if (valuelInit) stateRef.current.inert.valuelInit = valuelInit;
  }, []);

  useImperativeHandle(refs, () => ({
    sitData,
    sitValue,
    bthClickHandle,
  }), [sitData, sitValue, bthClickHandle]);

  // 声明式帧入口。按内容取键而非按 `params` 引用，否则调用方传内联字面量时
  // 每渲染一次就重画一帧。这里的 resetKey 还顺带补上一个缺口：换配色 / 换
  // `max` 之后，声明式通路会用新参数把当前帧重画一遍（命令式通路要等下一帧）。
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  useDeclarativeFrame(props.frame, sitData, paramsKey);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  );
});

export default BlobHeatmapRenderer;
