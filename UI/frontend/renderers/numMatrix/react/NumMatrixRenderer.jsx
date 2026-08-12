/**
 * NumMatrixRenderer.jsx - 参数化数字矩阵渲染器
 *
 * 替代 `components/three/` 下三份 NumThreeColor（Fast256 / Fast1024 /
 * Fast1024sit，共 1568 行）。三份逐行比对后的结论是**它们是同一个渲染器**：
 * 布局公式代数等价（证明见 `pipeline.test.js`），帧运算一字不差，真实差异
 * 只有五个开关，全部收进 `params.js`。
 *
 * 分三层，为的是后面接另两个后端时这一层不用重写：
 *
 * ```
 * NumMatrixRenderer.jsx   阈值来源、侧栏统计、命令式接口   ← 与画法无关
 * backends/sprite3d.js    three.js 精灵图 InstancedMesh    ← 只管画
 * pipeline.js             纯帧运算                          ← 可测
 * ```
 *
 * 照 `PointGridRenderer.jsx` 立的三步配方办：**写死常量参数化 → 模块级状态
 * 收进 `stateRef` → 补真正的卸载清理**。
 *
 * ## 两处从 props 改成参数的判断
 *
 * 原实现有两个按 `matrixName` 字符串写死的分支，二开的人加一个矩阵名就得回来
 * 改这个文件，所以都改成了声明式参数：
 *
 * | 原写法 | 现在 |
 * | :--- | :--- |
 * | `getDecimalScale(matrixName)`：`smallBed12B` → 10 | `decimalScale` 参数 |
 * | `getPressureChartPadding(matrixName)`：`smallBed12B` → 5 | `chartPadding` 参数 |
 * | `matrixName === 'smallBed12B' ? max : press` | `totalMetric` 参数 |
 * | `props.matrixName !== 'minzhen'` 才回写侧栏 | `manageSidebar` 参数 |
 *
 * 四者的取值都在 `LEGACY_PRESETS` 里，行为与原来逐字相同。
 *
 * 只有 `colormap` 与 `coordinateMap` 仍走 props 而不是 params —— 前者是用户
 * 在画布配置器里的实时选择，后者是坐标表数据，都由外层透传。两者已补进
 * `contract.js` 的 `RENDERER_PROPS`。
 *
 * ## 后端接口：4 个必需 + 4 个可选
 *
 * 必需的仍是原来那四个（`setFrame` / `retint` / `start` / `dispose`），工厂入参
 * 也没变，只多了一个 `reportStats`。可选的四个是 2026-08-06 那两轮接后端时加的：
 *
 * | 可选项 | 谁实现 | 干什么 |
 * | :--- | :--- | :--- |
 * | `commands` | canvas2d / webgl | 后端自有的命令式方法，原样铺进 `state.api` |
 * | `applyTuning(changed)` | canvas2d / webgl | `sitValue` 末尾回调，让后端吸收阈值变化 |
 * | `factory.commandNames` | canvas2d / webgl | 上面那些方法的名字，供 `useImperativeHandle` 用 |
 * | `setRawFrame(data)` | webgl | 接管 `changeWsDataRaw`：不过滤、不统计、原样上屏 |
 *
 * **为什么非得开这几个口子。** 接 `canvas2d` 时本来只该往 `BACKEND_FACTORIES`
 * 加一行（这个文件原来的注释就是这么写的），实际不够：`NumWs.jsx` 暴露 12 个
 * 命令式方法而本层只有 4 个，其中 `changeWsData147` / `changeWsData256` /
 * `changeWsDatafinger` / `changeWsDatapalm` **每次调用都换网格尺寸**
 * （36×36 / 16×16 / 32×32），`sprite3d` 的实例数在建场景时就定死了，做不到。
 *
 * 第四条是接 `webgl` 时加的：本层的 `changeWsDataRaw` 和 `changeWsData` 走的是
 * 同一条 `sitData`（会按 `valuef1` 过滤再回写侧栏），而 `Num2Doriginal` 的裸数据
 * 通路**既不过滤也不转成 sitData**，还要按矩阵类型转置。硬套本层那条会改画面。
 *
 * 四条都是**通用机制**，本层不认识任何一个后端专属的名字：`sprite3d` 一个都没
 * 实现，走的路径和以前逐字相同。
 */

import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import '../../../styles/canvas.css';
import { bed4096numParams } from '../../../core/bed4096numParams.js';
import { buildCoordinateWorldLayout } from '../../../core/coordinatePointLayout.js';
import { DUAL_CHANNEL_DEFAULTS, createThresholdState } from '../../../core/displayThresholds.js';
import { findMax } from '../../../core/frameMath.js';
import { deriveGrid, normalizeNumMatrixParams } from '../core/params.js';
import { applyFloorFilter, computeFrameStats, createRollingWindow } from '../core/pipeline.js';
import { createCanvas2dMatrixBackend } from './backends/canvas2d.js';
import { createSpriteMatrixBackend } from './backends/sprite3d.js';
import { createWebglMatrixBackend } from './backends/webgl.js';

/**
 * 后端分派表。
 *
 * 三条都齐了：`sprite3d`（three 精灵图）、`canvas2d`（CSS 透视伪 3D）、
 * `webgl`（热场 + 数字叠加层）。加第四条仍然只要往这里加一行。
 */
const BACKEND_FACTORIES = {
  sprite3d: createSpriteMatrixBackend,
  canvas2d: createCanvas2dMatrixBackend,
  webgl: createWebglMatrixBackend,
};

/**
 * 本层自己实现、与后端无关的命令式方法名。
 *
 * 后端可以再往上挂自己的（`factory.commandNames`），两者拼起来就是
 * `useImperativeHandle` 的全集。名字只有这一处，不会和后端那份漂移。
 */
const SHELL_METHODS = ['sitData', 'sitValue', 'changeWsData', 'changeWsDataRaw'];

/**
 * 可共享的调参对象。
 *
 * `bed4096` 这一份是 `assets/util/bed4096numParams.js` 的模块级单例，
 * Bed4096 与 Fast256 共用它，为的是「在这两个展示形式之间切换时调参不重置」。
 * 声明式地写成 `sharedTuningKey: 'bed4096'`，而不是让外层传对象进来 ——
 * 后者没法在 manifest 里表达。
 */
const SHARED_TUNING = {
  bed4096: bed4096numParams,
};

/**
 * 建一份调参状态。
 *
 * `valuep` / `valueprop` 不在 `displayThresholds` 的六个阈值里 —— 它们是
 * 分压重分配的两个参数，原实现是模块级 `var valuep = 0, valueprop = 1`
 * （所以两个实例会互相踩）。这里挂到同一个对象上，一起变成每实例。
 *
 * @param {string|null} sharedKey 共享调参对象的键；为空则建实例私有的。
 * @returns {object} 调参状态。
 */
function createTuningState(sharedKey) {
  const base = (sharedKey && SHARED_TUNING[sharedKey]) || createThresholdState(DUAL_CHANNEL_DEFAULTS);
  if (base.valuep === undefined) base.valuep = 0;
  if (base.valueprop === undefined) base.valueprop = 1;
  return base;
}

const NumMatrixRenderer = React.forwardRef((props, refs) => {
  // 按参数"内容"而非引用做记忆化。调用方常常传内联对象字面量，
  // 若依赖引用，每次父组件渲染都会重建整个 WebGL 场景。
  const paramsKey = JSON.stringify(normalizeNumMatrixParams(props.params));
  const config = useMemo(() => JSON.parse(paramsKey), [paramsKey]);

  const containerRef = useRef(null);
  const peakRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 全部运行期可变状态集中在此，替代原文件的模块级 `ndata1` /
  // `animationRequestId` / `materialRef` / `totalArr` / `totalPointArr`。
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = {
      tuning: createTuningState(config.sharedTuningKey),
      totalWindow: createRollingWindow(config.chartWindow),
      pointWindow: createRollingWindow(config.chartWindow),
      backend: null,
      api: null,
    };
  }

  // 坐标表决定实例数与布局，内容变了要重建场景，所以按内容记忆化。
  const coordinateKey = JSON.stringify(props.coordinateMap || null);
  const coordinateLayout = useMemo(
    () => buildCoordinateWorldLayout(JSON.parse(coordinateKey)),
    [coordinateKey],
  );

  // 配色换了由外层的 variantKey 整场重建，但这里仍按内容取值，
  // 免得命令式入口读到旧配色。
  const colormapKey = JSON.stringify(props.colormap || null);

  useEffect(() => {
    const state = stateRef.current;
    const container = containerRef.current;
    if (!container) return undefined;

    const grid = deriveGrid(config);
    const createBackend = BACKEND_FACTORIES[config.backend] || createSpriteMatrixBackend;

    state.totalWindow = createRollingWindow(config.chartWindow);
    state.pointWindow = createRollingWindow(config.chartWindow);

    /**
     * 回写侧栏读数与两条滚动曲线。
     *
     * 逐字对应 `NumThreeColor1024.jsx:98-202`，也逐字对应 `NumWs.jsx:341-374`
     * 的 `layoutData` —— 两份原实现在这一段是同一套算法，差的只是窗口长度、
     * 留白和总压曲线那个 `-1`，全部已参数化。
     *
     * **`changeData` 不受 `local` 影响，两条曲线才受**（回放模式没有侧栏图表）。
     * 这个不对称是原实现的，两份都一样。
     *
     * 单独提出来是因为后端的自有命令（`changeWsData147` 等）绕开了 `sitData`
     * 却仍要驱动侧栏，所以它作为 `reportStats` 传给工厂。
     *
     * @param {number[]} sourceArr 统计所依据的帧。
     * @param {boolean} [local] 回放模式；为真时不驱动侧栏曲线。
     */
    function reportStats(sourceArr, local = propsRef.current.local) {
      if (!config.manageSidebar) return;

      const { max, point, total, mean } = computeFrameStats(sourceArr);
      const displayPress = config.totalMetric === 'max' ? max : total;
      const host = propsRef.current;

      host.data?.current?.changeData({
        meanPres: mean.toFixed(2),
        maxPres: max,
        point,
        totalPres: displayPress,
      });

      // Y 轴上界取的是**偏移前**的最大值，偏移只作用在画出去的那份数据上
      // —— `NumWs.jsx:360-362` 就是这么写的，照抄。
      const totalArr = state.totalWindow.push(displayPress);
      const maxTotal = findMax(totalArr);
      const offset = config.totalChartOffset;
      const totalSeries = offset > 0
        ? totalArr.map((a) => (a - offset > 0 ? a - offset : 0))
        : totalArr;
      if (!local) {
        host.data?.current?.handleCharts(totalSeries, maxTotal + config.chartPadding);
      }

      const pointArr = state.pointWindow.push(point);
      if (!local) {
        host.data?.current?.handleChartsArea(
          pointArr, findMax(pointArr) + config.pointChartPadding,
        );
      }
    }

    state.backend = createBackend({
      container,
      config,
      grid,
      coordinateLayout,
      colormap: JSON.parse(colormapKey) || {},
      tuning: state.tuning,
      reportStats,
      onPeak: (index) => {
        // 原实现是 `document.querySelector('.maxNum').innerHTML = index + 1`。
        // 走 ref 而不是全局选择器，两个实例才不会写到同一个 div；
        // 仍然直接改 DOM 而不进 state —— 这是 60Hz 的读数。
        if (peakRef.current) peakRef.current.textContent = String(index);
      },
    });

    /**
     * 收一帧数据。
     *
     * 注意**下限过滤做两遍**：这里一遍（不取整，统计走浮点），后端画之前再
     * 一遍（取整）。两遍是幂等的，原实现就是这样，照抄。
     *
     * `statsBeforeFilter` 决定侧栏统计看过滤前还是过滤后的帧 —— 三份
     * `NumThreeColor*` 看过滤后，`NumWs.jsx` 看过滤前，两者的「合力」读数会差
     * 一个 `valuef1 × 受压点数`。
     *
     * @param {object} prop 帧数据，`wsPointData` 是压力数组。
     * @param {boolean} local 回放模式；为真时不驱动侧栏曲线。
     */
    function sitData(prop, local) {
      const t = state.tuning;
      const source = prop?.wsPointData;
      const dataArr = applyFloorFilter(source, t.valuef1);
      state.backend?.setFrame(dataArr);
      reportStats(config.statsBeforeFilter && Array.isArray(source) ? source : dataArr, local);
    }

    /**
     * 应用调参变化。
     *
     * 守卫用 `!== undefined` 而不是 `if (valuej)`，抄的是 `NumThreeColor1024`
     * 那份 —— 另两份的真值守卫会把 0 当成"没传"忽略掉。滑块能不能出 0 没验，
     * 但接受 0 是这两种写法里更不会出错的一边。
     *
     * @param {object} configValue 六个阈值 + 分压两参数。
     */
    function sitValue(configValue = {}) {
      const t = state.tuning;
      const { valuej, valueg, value, valuel, valuef, valuelInit, press, prop } = configValue;
      if (valuej !== undefined) {
        t.valuej1 = valuej;
        state.backend?.retint();
      }
      if (valueg !== undefined) t.valueg1 = valueg;
      if (value !== undefined) t.value1 = value;
      if (valuel !== undefined) t.valuel1 = valuel;
      if (valuef !== undefined) t.valuef1 = valuef;
      if (valuelInit !== undefined) t.valuelInit1 = valuelInit;
      if (typeof press === 'number') t.valuep = press;
      if (typeof prop === 'number') t.valueprop = prop;

      // 后端可以再自己吸收一遍。`canvas2d` 用它把 `value` / `valuej` 拉进
      // 字高与色标上限；`sprite3d` 没实现，可选链走空。
      state.backend?.applyTuning?.(configValue);
    }

    state.api = {
      // 后端自有的命令式方法铺在最前，本层那四个覆盖同名项 —— 后端不该能
      // 改掉 `sitData` 的语义，那是所有渲染器共通的入口。
      ...(state.backend.commands || {}),
      sitData,
      sitValue,
      changeWsData: (wsPointData) => sitData({ wsPointData }, propsRef.current.local),

      // 裸数据通路。后端实现了 `setRawFrame` 就交给它（`webgl` 那份不过滤、
      // 不走 `sitData`、还要按矩阵类型转置），没实现就退回和 `changeWsData`
      // 同一条 —— 这正是接 `webgl` 之前所有后端的行为。
      changeWsDataRaw: (wsPointData) => (
        state.backend?.setRawFrame
          ? state.backend.setRawFrame(wsPointData)
          : sitData({ wsPointData }, propsRef.current.local)
      ),
    };

    state.backend.start();

    return () => {
      state.api = null;
      state.backend?.dispose();
      state.backend = null;
    };
    // 参数、坐标表、配色任一变化都要重建场景：它们决定实例数、
    // 顶点缓冲区大小与精灵图内容。
  }, [config, coordinateLayout, colormapKey]);

  // 命令式接口走 state.api 中转而非直接闭包，这样参数变化重建场景后，
  // 外部持有的 ref 仍然指向新场景，不会调到已释放的 three.js 对象。
  //
  // 方法名来自「本层四个 + 后端工厂上挂的 `commandNames`」，不再手写一遍
  // —— 两张平行的表一定会漂移。依赖只有 `config.backend`：换后端才换方法集，
  // 换网格/配色不换。
  useImperativeHandle(refs, () => {
    const factory = BACKEND_FACTORIES[config.backend] || createSpriteMatrixBackend;
    const names = [...SHELL_METHODS, ...(factory.commandNames || [])];
    return Object.fromEntries(names.map(
      (name) => [name, (...args) => stateRef.current.api?.[name]?.(...args)],
    ));
  }, [config.backend]);

  return (
    <>
      <div className="canvasNum" ref={containerRef} />
      <div
        className="maxNum"
        ref={peakRef}
        style={{ position: 'fixed', left: '5%', bottom: '5%', color: '#fff' }}
      />
    </>
  );
});

NumMatrixRenderer.displayName = 'NumMatrixRenderer';

export default NumMatrixRenderer;
