/**
 * renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx - 斑点热力（WebGL）
 *
 * 搬自 `client/src/components/webgl/Canvas4096WebGL.jsx`（187 行）。原文件已经
 * 长得很像渲染器了 —— `forwardRef` + `sitData` / `sitValue` / `changeColor` /
 * `bthClickHandle`，`props.data.current` 那三个未声明方法也照着调。所以这一趟
 * 主要是**把写死值参数化**，不是重写。
 *
 * 原来写死在 `renderFrame` 与 `genWebglHeatmap` 里的：矩阵 64×64、画布
 * 1024×1024、点半径 24、数值 ×1.8、边缘清零窗口 `[6, 58]`、左右镜像、帧长门槛
 * 4096、曲线滑窗 20、显示边长 `80vh`。现在全在 `renderers/webglHeatmap/core/params.js`，
 * 帧运算在 `renderers/webglHeatmap/core/pipeline.js`（纯函数，有逐点测试）。
 *
 * ## 一处**行为修正**（不是搬家的一部分，明说）
 *
 * 原件的 rAF 循环**无条件每帧重画**，哪怕一帧数据都没来过 —— 60fps 空转。这里
 * 改成"数据或参数变过才重画"（一个 `dirty` 标志）。静态画面下的像素完全相同，
 * 差别只在不再空烧 GPU。之所以顺手做，是因为 `blobs.js` 那份每帧泄漏 GL 对象的
 * 老毛病修掉之后，空转的代价从"泄漏"变成"纯浪费"，留着没有任何理由。
 *
 * ## 尺寸：这一个是按容器画的
 *
 * 外层容器跟随宿主尺寸，`displaySize` 只控制内部画布边长。它不做指针坐标换算
 * （没有框选），因此画布按宿主缩放不会影响数据映射。
 */

import React, {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef,
} from 'react';

import { normalizeWebglHeatmapParams } from '../core/params.js';
import {
  buildHeatPoints,
  frameStats,
  prepareFrame,
  pushWindow,
} from '../core/pipeline.js';
import { useDeclarativeFrame } from '../../shared/react/useDeclarativeFrame.js';
import { WebGLCanvas } from './blobs.js';

const WebglHeatmapRenderer = React.forwardRef(function WebglHeatmapRenderer(props, refs) {
  const canvasRef = useRef(null);
  const painterRef = useRef(null);
  const rafRef = useRef(null);

  const params = useMemo(
    () => normalizeWebglHeatmapParams(props.params),
    [props.params],
  );
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const stateRef = useRef({
    frame: [],
    cfg: { max: params.max, filter: params.filter, size: params.radius },
    totalWindow: [],
    pointWindow: [],
    dirty: true,
  });

  // 预设换了要跟着换调参基线，否则切预设只改尺寸不改阈值。
  useEffect(() => {
    stateRef.current.cfg = { max: params.max, filter: params.filter, size: params.radius };
    stateRef.current.dirty = true;
  }, [params.max, params.filter, params.radius]);

  /**
   * 把一帧的读数推给宿主。
   *
   * ⚠️ `props.data.current` 上那三个方法**契约里没有声明** —— 宿主传了 `data`
   * 就得把三个都挂上。这是全仓的既有约定，`sdk/frontend/README.md` 有专门一节。
   *
   * @param {number[]} raw 原始帧（不是预处理后的）。
   * @param {boolean} isLocal 本地模式不画侧栏曲线。
   * @returns {void}
   */
  const publishStats = useCallback((raw, isLocal) => {
    const stats = frameStats(raw);
    props.data?.current?.changeData(stats);

    const { chartWindow } = paramsRef.current;
    const totals = pushWindow(stateRef.current.totalWindow, stats.totalPres, chartWindow);
    const points = pushWindow(stateRef.current.pointWindow, stats.point, chartWindow);

    if (isLocal) return;
    const maxTotal = totals.reduce((acc, item) => (acc > item ? acc : item), 0);
    const maxPoint = points.reduce((acc, item) => (acc > item ? acc : item), 0);
    props.data?.current?.handleCharts(totals, maxTotal + 1000);
    props.data?.current?.handleChartsArea(points, maxPoint + 100);
  }, [props.data]);

  /** 画一帧。 */
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const painter = painterRef.current;
    if (!canvas || !painter) return;

    const current = paramsRef.current;
    const { max, filter, size } = stateRef.current.cfg;
    const values = prepareFrame(stateRef.current.frame, { ...current, filter });
    const points = buildHeatPoints(values, current);

    const source = painter.render({
      width: current.canvasWidth,
      height: current.canvasHeight,
      radius: size,
      max,
      min: 0,
      filter: 0,
      blurFactor: current.blurFactor,
      class: 'body',
    }, points)[0];

    const ctx = canvas.getContext('2d');
    if (ctx && source) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    painterRef.current = new WebGLCanvas();
    const loop = () => {
      if (stateRef.current.dirty) {
        stateRef.current.dirty = false;
        renderFrame();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      painterRef.current = null;
    };
  }, [renderFrame]);

  /**
   * 收一帧数据。短于 `minFrameLength` 的整帧丢弃（原件写死 4096）。
   *
   * @param {{wsPointData?: number[], local?: boolean}} prop 帧。
   * @returns {void}
   */
  const sitData = useCallback((prop) => {
    const { wsPointData, local } = prop || {};
    if (!wsPointData || wsPointData.length < paramsRef.current.minFrameLength) return;
    stateRef.current.frame = wsPointData;
    stateRef.current.dirty = true;
    publishStats(wsPointData, local ?? props.local);
  }, [publishStats, props.local]);

  /**
   * 侧栏两个滑块。`valuej` → 满值阈值，`valuef` → 下限。
   *
   * @param {{valuej?: number, valuef?: number}} obj 调参。
   * @returns {void}
   */
  const sitValue = useCallback((obj) => {
    if (!obj) return;
    if (obj.valuej !== undefined) stateRef.current.cfg.max = obj.valuej;
    if (obj.valuef !== undefined) stateRef.current.cfg.filter = obj.valuef;
    stateRef.current.dirty = true;
  }, []);

  /**
   * 另一路调参入口（`max` / `filter` / `size` 直给）。
   *
   * @param {{max?: number, filter?: number, size?: number}} obj 调参。
   * @returns {void}
   */
  const changeColor = useCallback((obj) => {
    if (!obj) return;
    if (obj.max !== undefined) stateRef.current.cfg.max = obj.max;
    if (obj.filter !== undefined) stateRef.current.cfg.filter = obj.filter;
    if (obj.size !== undefined) stateRef.current.cfg.size = obj.size;
    stateRef.current.dirty = true;
  }, []);

  /**
   * 收峰值帧、**同步**画一帧并把画布交出去（导出 PDF 用）。
   *
   * 同步是必须的：调用方拿到返回值立刻 `toDataURL`，等不到下一次 rAF。
   *
   * @param {number[]} wsPointData 峰值帧。
   * @returns {HTMLCanvasElement | null} 画布。
   */
  const bthClickHandle = useCallback((wsPointData) => {
    if (wsPointData && wsPointData.length >= paramsRef.current.minFrameLength) {
      stateRef.current.frame = wsPointData;
      publishStats(wsPointData, props.local);
    }
    renderFrame();
    stateRef.current.dirty = false;
    return canvasRef.current;
  }, [publishStats, renderFrame, props.local]);

  useImperativeHandle(refs, () => ({
    sitData,
    sitValue,
    changeColor,
    bthClickHandle,
  }), [sitData, sitValue, changeColor, bthClickHandle]);

  // 声明式帧入口。`params` 已按引用记忆化，这里再按内容取键：调用方传内联
  // 字面量时引用每次都变，用引用做依赖会每渲染一次就重推一帧。
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  useDeclarativeFrame(props.frame, sitData, paramsKey);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: params.background,
      }}
    >
      <canvas
        ref={canvasRef}
        width={params.canvasWidth}
        height={params.canvasHeight}
        style={{
          width: params.displaySize,
          height: params.displaySize,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      />
    </div>
  );
});

export default WebglHeatmapRenderer;
