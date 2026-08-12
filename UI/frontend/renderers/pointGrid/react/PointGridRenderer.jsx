/**
 * PointGridRenderer.jsx - 参数化点阵渲染器
 *
 * 由 components/three/matCol.jsx 机械变换而来（原文件与 carCol.jsx 已于
 * 2026-07-31 接线完成后删除，历史见 git）。渲染数学逐行保留，
 * 只做三类结构性改动：
 *
 * 1. 参数化：sitnum1/sitnum2/sitInterp/sitOrder 等常量改为 params 注入。
 *    matCol 与 carCol 的净差异只有两个数字（sitnum1、sitOrder），
 *    参数化后一个渲染器即可覆盖两者，逐帧一致性由 pipeline.test.js 证明。
 *
 * 2. 状态实例化：原文件把帧缓冲 ndata/ndata1、12 个调参变量、图表累积
 *    totalArr/totalPointArr、节流计时 timeS 等放在模块作用域，跨实例共享。
 *    这是 55 个场景组件必须各自复制一份文件的根本原因——复制文件是当时
 *    唯一的隔离手段。这里全部收进 stateRef，同一渲染器可安全多实例。
 *
 * 3. 卸载清理：原文件只调 cancelAnimationFrame，泄漏 WebGL 上下文、
 *    几何体、材质、贴图与五类事件监听。其中 document 上的 keydown 用的是
 *    匿名函数，原实现根本无法移除，每次挂载都会永久累加一个全局监听器。
 *
 * 渲染数学未做任何优化。sitRenew 中每帧重建 BufferAttribute 的写法予以保留，
 * 待视觉验证通过后再单独处理，避免污染一致性基准。
 *
 * ## 搬进 `@shroom/frontend` 时修掉的两处包边界问题（2026-08-05）
 *
 * 这两条在主应用里都不是 bug，一旦装进别人的项目就是。
 *
 * 1. **`circle.png` 原来写死成运行期相对 URL** —— `TextureLoader().load('./circle.png')`。
 *    这张图现在靠 `client/public/circle.png` 恰好被 serve 在站点根目录，**装进
 *    别人的项目就是 404 → 点阵全白**（`TextureLoader` 加载失败不抛错，只是贴图
 *    永远是空的）。改成把图放进包里 `import` 进来，让打包器发出资源并给出正确
 *    的 URL。主应用拿到的是同一张图的 hash URL，画面零变化。
 *    → **这给消费者加了第四条义务：打包器要能处理 `.png` import。** Vite 原生
 *      支持，webpack5 走 asset modules。README 与文档站都写了这条。
 *    → 另开了一个 `params.pointSprite` 让消费者换图（见下面 `spriteUrl`）。
 *    → `client/public/circle.png` **没有删**：还有约 30 个旧场景组件在用
 *      `'./circle.png'` 那条老路。
 *
 * 2. **`TrackballControls` 的 import 少了 `.js`。** 主应用装的 three@0.127.0
 *    没有 exports map，靠扩展名猜测能解析；three ≥0.152 的 exports map 是
 *    `"./examples/jsm/*"` 通配，**不带扩展名直接解析失败**。而本包 peer 范围写的
 *    是 `three: ">=0.127"` —— 也就是那句声明在 0.150 以上是假的。加上 `.js`
 *    两边都对（0.127 里文件名本来就叫 `TrackballControls.js`）。
 *
 * ## 一处**没修**、只声明的包边界问题
 *
 * `props.data.current` 上的 `changeData` / `handleCharts` / `handleChartsArea`
 * 是宿主注入的命令式回调，**契约（`core/contract.js` 的 `RENDERER_PROPS`）里
 * 只声明了 `data` 这个 prop，没有声明 `current` 上要有哪三个方法**。而调用点
 * 写的是 `host.data?.current?.changeData({...})` —— 可选链只护到 `current`，
 * 传了个没有这三个方法的 ref 进来照样 `TypeError`。本轮只补声明（README +
 * 文档站的「入参」页），不改代码：改成 `?.changeData?.()` 会静默吞掉宿主的
 * 接线错误，比崩掉更难查。
 */

import * as THREE from 'three';
import { TextureLoader } from 'three';
// `.js` 不能省，理由见文件头第 2 条。
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import { SelectionHelper } from '../../shared/three/SelectionHelper.js';
import {
  checkRectIndex,
  checkRectangleIntersection,
  getPointCoordinate,
} from '../../shared/three/pointPick.js';
// 逐个模块引，不走 `../../core/index.js` 那个 barrel —— 与
// `../numMatrix/NumMatrixRenderer.jsx` 同一套写法。barrel 会把整个零依赖层
// 拉进这个动态 chunk，懒加载的意义就没了。
import { DUAL_CHANNEL_DEFAULTS, createThresholdState } from '../../../core/displayThresholds.js';
import { addSide, findMax, gaussBlur_1, interpSmall, jet } from '../../../core/frameMath.js';
import { jetgGrey } from '../../../core/greyLadder.js';
import { deriveGridSize, normalizePointGridParams } from '../core/params.js';
import { buildPointGridBasePositions } from '../core/pipeline.js';
// 打包器把它变成一个真实存在的 URL；理由见文件头第 1 条。
// 2026-08-07 从 `./circle.png` 挪到 `../../shared/three/`：`handPoints` 渲染器也要这张图，
// 放在两个渲染器目录之一会让另一个跨目录引资源。它和 `SelectionHelper` /
// `pointPick` 一样是「点阵这一族共用的东西」，归 `renderers/shared/three/`。
import circleUrl from '../../shared/three/circle.png';

const ALT_KEY = 18;
const CTRL_KEY = 17;
const CMD_KEY = 91;

/** 相机与 group 的初始摆位，抄自 matCol.jsx:161-180 */
const GROUP_ORIGIN = { x: 5, y: 150, z: 230 };

/**
 * 创建一份实例私有的调参状态。
 *
 * 对应 matCol.jsx:40-51 的 12 个模块级变量。后缀 1 为坐垫通道，2 为靠背通道。
 *
 * 这里原本有本文件自己的 `readStoredNumber` + `createTuningState`（十二行
 * 一模一样的 `readStoredNumber('carValuej', 200)`）。那份实现就是
 * `runtime/displayThresholds.js` 的原型 —— 抽公共层时把它连同其余 47 个
 * 声明块一起收进了那个模块，这里改成直接调，行为逐字相同。
 *
 * @returns {object} 调参状态。
 */
function createTuningState() {
  return createThresholdState(DUAL_CHANNEL_DEFAULTS);
}

const PointGridRenderer = React.forwardRef((props, refs) => {
  // 按参数"内容"而非引用做记忆化。调用方常常传内联对象字面量，
  // 若依赖引用，每次父组件渲染都会重建整个 WebGL 场景。
  const paramsKey = JSON.stringify(normalizePointGridParams(props.params));
  const config = useMemo(() => JSON.parse(paramsKey), [paramsKey]);
  const sit = config.sit;
  const back = config.back;

  // 点精灵贴图。缺省用包里自带的那张 4.7kB 圆点（见文件头第 1 条）；
  // 消费者想换成方点 / 带光晕的图，传一个 URL 进来即可。
  // 刻意不进 `normalizePointGridParams` —— 那一层在 `core/`，是零依赖层，
  // 不该知道「有一张图被打包器发出来了」这件事。
  const spriteUrl = props.params?.pointSprite || circleUrl;

  const containerRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 全部运行期可变状态集中在此，替代原文件的模块级变量。
  // 用 ref 而非 state：这些值以 30-100Hz 变化，进 state 会触发重渲染。
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = {
      tuning: createTuningState(),
      ndata: new Array(back.num1 * back.num2).fill(0),
      ndata1: new Array(sit.num1 * sit.num2).fill(0),
      ndataNum: 0,
      ndata1Num: 0,
      totalArr: [],
      totalPointArr: [],
      timeS: 0,
      controlsFlag: true,
      colSelectFlag: false,
      dataFlag: false,
      selectStartArr: [],
      selectEndArr: [],
      sitMatrix: [],
      backMatrix: [],
      sitIndexArr: [],
      sitIndexEndArr: [],
      backIndexArr: [],
      backIndexEndArr: [],
      debounceTimer: null,
      // three.js 对象在 init() 中填充，dispose() 中释放
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      selectHelper: null,
      group: null,
      particles: null,
      sitGeometry: null,
      material: null,
      texture: null,
      positions: null,
      colors: null,
      scales: null,
      smoothBig: null,
      bigArrg: null,
      animationRequestId: null,
      disposed: false,
    };
  }

  useEffect(() => {
    const state = stateRef.current;
    const container = containerRef.current;
    if (!container) return undefined;

    const { amountX: AMOUNTX, amountY: AMOUNTY } = deriveGridSize(sit);
    const { amountX: AMOUNTX1, amountY: AMOUNTY1 } = deriveGridSize(back);
    const SEPARATION = config.separation;
    const renderT = 1 / config.fps;
    const clock = new THREE.Clock();
    const gridTotal = AMOUNTX * AMOUNTY;
    const basePositions = buildPointGridBasePositions({
      amountX: AMOUNTX,
      amountY: AMOUNTY,
      separation: SEPARATION,
      points: config.points,
    });
    let resizeObserver = null;

    state.disposed = false;
    state.bigArrg = new Array(gridTotal).fill(1);
    state.smoothBig = new Array(gridTotal).fill(1);
    state.ndata1 = new Array(sit.num1 * sit.num2).fill(0);
    state.ndata = new Array(back.num1 * back.num2).fill(0);

    /**
     * 防抖。原实现用模块级 timer，多实例会互相打断，这里改为实例私有。
     */
    function debounce(fn, time) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(fn, time);
    }

    /**
     * 框选区域变化后回推选中索引。抄自 matCol.jsx:253-341 的四个方向分支，
     * 原实现把同一段逻辑复制了四遍，这里合并为一个函数。
     */
    function syncSelectionFromHelper() {
      if (state.controlsFlag || !state.selectHelper?.element) return;

      const rect = state.selectHelper.element.getBoundingClientRect();
      const selectRect = [rect.left, rect.top, rect.right, rect.bottom];
      const sitInterArr = checkRectangleIntersection(selectRect, state.sitMatrix);
      const backInterArr = checkRectangleIntersection(selectRect, state.backMatrix);

      if (sitInterArr) {
        state.sitIndexArr = checkRectIndex(state.sitMatrix, sitInterArr, AMOUNTX, AMOUNTY);
      }
      if (backInterArr) {
        state.backIndexArr = checkRectIndex(state.backMatrix, backInterArr, AMOUNTX1, AMOUNTY1);
      }

      debounce(() => {
        propsRef.current.changeSelect?.({ sit: state.sitIndexArr, back: state.backIndexArr });
      }, 500);
    }

    const ARROW_STEP = {
      ArrowUp: ['top', -1],
      ArrowDown: ['top', 1],
      ArrowLeft: ['left', -1],
      ArrowRight: ['left', 1],
    };

    /**
     * 方向键微调选区。
     *
     * 原实现挂在 document 上且用匿名函数，无法移除；这里改为具名函数
     * 并在卸载时解绑。
     */
    function onDocumentKeyDown(event) {
      const step = ARROW_STEP[event.key];
      if (!step || !state.selectHelper?.element) return;

      const [axis, delta] = step;
      const current = parseInt(state.selectHelper.element.style[axis], 10) || 0;
      state.selectHelper.element.style[axis] = `${current + delta}px`;
      syncSelectionFromHelper();
    }

    function pointDown(event) {
      if (!state.selectHelper?.isShiftPressed) return;
      state.sitIndexArr = [];
      state.selectStartArr = [event.clientX, event.clientY];
      const sitArr = getPointCoordinate({
        particles: state.particles,
        camera: state.camera,
        position: GROUP_ORIGIN,
      });
      state.sitMatrix = [sitArr[0].x, sitArr[0].y, sitArr[1].x, sitArr[1].y];
      state.colSelectFlag = true;
    }

    function pointMove(event) {
      if (!state.selectHelper?.isShiftPressed || !state.colSelectFlag) return;

      state.selectEndArr = [event.clientX, event.clientY];
      const [startX, startY] = state.selectStartArr;
      const [endX, endY] = state.selectEndArr;

      const width = Math.abs(Math.round(endX - startX));
      const height = Math.abs(Math.round(endY - startY));
      const selectRect = [
        Math.min(startX, endX),
        Math.min(startY, endY),
        Math.max(startX, endX),
        Math.max(startY, endY),
      ];

      if (state.controlsFlag) return;

      const sitInterArr = checkRectangleIntersection(selectRect, state.sitMatrix);
      const backInterArr = checkRectangleIntersection(selectRect, state.backMatrix);

      if (sitInterArr) {
        state.sitIndexArr = checkRectIndex(state.sitMatrix, sitInterArr, AMOUNTX, AMOUNTY);
        state.sitIndexEndArr = [...state.sitIndexArr];
      }
      if (backInterArr) {
        state.backIndexArr = checkRectIndex(state.backMatrix, backInterArr, AMOUNTX1, AMOUNTY1);
        state.backIndexEndArr = [...state.backIndexArr];
      }

      propsRef.current.changeStateData?.({ width, height });
    }

    function pointUp() {
      if (!state.selectHelper?.isShiftPressed) return;
      propsRef.current.changeSelect?.({
        sit: state.sitIndexEndArr,
        back: state.backIndexEndArr,
      });
      state.selectStartArr = [];
      state.selectEndArr = [];
      state.colSelectFlag = false;
    }

    /** 恢复 TrackballControls 的默认按键映射，抄自 matCol.jsx:216-225 */
    function applyDefaultControlBindings() {
      if (!state.controls) return;
      state.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.ZOOM,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      state.controls.keys = [ALT_KEY, CTRL_KEY, CMD_KEY];
    }

    function onKeyDown(event) {
      if (event.key !== 'Shift' || !state.controls) return;
      state.controls.mouseButtons = null;
      state.controls.keys = null;
    }

    function onKeyUp(event) {
      if (event.key !== 'Shift') return;
      applyDefaultControlBindings();
    }

    function onWindowResize() {
      if (!state.renderer || !state.camera) return;
      const width = Math.max(1, container.clientWidth || window.innerWidth);
      const height = Math.max(1, container.clientHeight || window.innerHeight);
      state.renderer.setSize(width, height, false);
      state.camera.aspect = width / height;
      state.camera.updateProjectionMatrix();
    }

    /** 构建点阵几何体，抄自 matCol.jsx:438-494 */
    function initSet() {
      const numParticles = AMOUNTX * AMOUNTY;
      state.positions = new Float32Array(numParticles * 3);
      state.scales = new Float32Array(numParticles);
      state.colors = new Float32Array(numParticles * 3);

      for (let pointIndex = 0; pointIndex < numParticles; pointIndex += 1) {
        const offset = pointIndex * 3;
        state.positions[offset] = basePositions[offset];
        state.positions[offset + 1] = 0;
        state.positions[offset + 2] = basePositions[offset + 2];
        state.scales[pointIndex] = 1;
        state.colors[offset] = 0;
        state.colors[offset + 1] = 0;
        state.colors[offset + 2] = 1;
      }

      state.sitGeometry = new THREE.BufferGeometry();
      state.sitGeometry.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
      state.sitGeometry.setAttribute('scale', new THREE.BufferAttribute(state.scales, 1));
      state.sitGeometry.setAttribute('color', new THREE.BufferAttribute(state.colors, 3));

      state.texture = new TextureLoader().load(spriteUrl);
      state.material = new THREE.PointsMaterial({
        vertexColors: true,
        transparent: true,
        map: state.texture,
        size: 1,
      });

      state.particles = new THREE.Points(state.sitGeometry, state.material);
      state.particles.scale.set(0.0062, 0.0062, 0.0062);
      state.particles.rotation.x = Math.PI / 3;
      state.group.add(state.particles);
    }

    function init() {
      state.group = new THREE.Group();

      const viewportWidth = Math.max(1, container.clientWidth || window.innerWidth);
      const viewportHeight = Math.max(1, container.clientHeight || window.innerHeight);

      state.camera = new THREE.PerspectiveCamera(
        40,
        viewportWidth / viewportHeight,
        1,
        150000,
      );
      state.camera.position.z = 300;
      state.camera.position.y = 200;

      state.scene = new THREE.Scene();

      initSet();
      state.group.position.set(GROUP_ORIGIN.x, GROUP_ORIGIN.y, GROUP_ORIGIN.z);
      state.scene.add(state.group);

      const helper = new THREE.GridHelper(2000, 100);
      helper.position.y = -199;
      helper.material.opacity = 0.25;
      helper.material.transparent = true;
      state.scene.add(helper);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
      hemiLight.position.set(0, 200, 0);
      state.scene.add(hemiLight);
      const dirLight = new THREE.DirectionalLight(0xffffff);
      dirLight.position.set(0, 200, 10);
      state.scene.add(dirLight);
      const dirLight1 = new THREE.DirectionalLight(0xffffff);
      dirLight1.position.set(0, 10, 200);
      state.scene.add(dirLight1);

      state.renderer = new THREE.WebGLRenderer({ antialias: true });
      state.renderer.setPixelRatio(window.devicePixelRatio);
      state.renderer.setSize(viewportWidth, viewportHeight, false);
      state.renderer.outputColorSpace = THREE.SRGBColorSpace;
      state.renderer.setClearColor(0x000000);
      container.replaceChildren(state.renderer.domElement);

      state.controls = new TrackballControls(state.camera, state.renderer.domElement);
      state.controls.dynamicDampingFactor = 0.2;
      state.controls.domElement = container;
      applyDefaultControlBindings();

      state.selectHelper = new SelectionHelper(state.renderer, state.controls, 'selectBox');

      window.addEventListener('resize', onWindowResize);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(onWindowResize);
        resizeObserver.observe(container);
      }
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      document.addEventListener('keydown', onDocumentKeyDown);
      state.renderer.domElement.addEventListener('pointerdown', pointDown);
      state.renderer.domElement.addEventListener('pointermove', pointMove);
      state.renderer.domElement.addEventListener('pointerup', pointUp);
    }

    /** 更新坐垫数据，抄自 matCol.jsx:585-704 */
    function sitRenew() {
      if (state.disposed || !state.particles) return;
      const t = state.tuning;

      const interpolated = interpSmall(state.ndata1, sit.num2, sit.num1, sit.interp, sit.interp);
      const padded = addSide(
        interpolated,
        sit.num2 * sit.interp,
        sit.num1 * sit.interp,
        sit.order,
        sit.order,
      );
      gaussBlur_1(padded, state.bigArrg, AMOUNTY, AMOUNTX, t.valueg1);

      const { positions, colors, smoothBig, bigArrg, sitIndexArr } = state;
      const hasSelection = sitIndexArr && sitIndexArr.length > 0
        && !sitIndexArr.every((a) => a === 0);

      let k = 0;
      let l = 0;
      let dataArr = [];
      for (let ix = 0; ix < AMOUNTX; ix += 1) {
        for (let iy = 0; iy < AMOUNTY; iy += 1) {
          const value = bigArrg[l] * 10;
          smoothBig[l] = smoothBig[l] + (value - smoothBig[l] + 0.5) / t.valuel1;

          positions[k] = basePositions[k];
          positions[k + 1] = smoothBig[l] * t.value1;
          positions[k + 2] = basePositions[k + 2];

          let rgb;
          if (hasSelection) {
            const inside = ix >= sitIndexArr[0] && ix < sitIndexArr[1]
              && iy >= sitIndexArr[2] && iy < sitIndexArr[3];
            if (inside) {
              rgb = jet(0, t.valuej1, smoothBig[l]);
              dataArr.push(bigArrg[l]);
            } else {
              rgb = jetgGrey(0, t.valuej1, smoothBig[l]);
            }
          } else {
            rgb = jet(0, t.valuej1, smoothBig[l]);
          }

          colors[k] = rgb[0] / 255;
          colors[k + 1] = rgb[1] / 255;
          colors[k + 2] = rgb[2] / 255;
          k += 3;
          l += 1;
        }
      }

      if (!hasSelection) dataArr = bigArrg;

      state.timeS += clock.getDelta();
      if (state.timeS > renderT) {
        const filtered = dataArr.filter((a) => a > t.valuej1 * 0.025);
        const max = findMax(filtered);
        const point = filtered.filter((a) => a > 0).length;
        const press = filtered.reduce((a, b) => a + b, 0);
        const mean = press / (point === 0 ? 1 : point);

        const host = propsRef.current;
        host.data?.current?.changeData({
          meanPres: mean.toFixed(2),
          maxPres: max,
          point,
          totalPres: press,
        });

        if (state.totalArr.length >= 20) state.totalArr.shift();
        state.totalArr.push(press);
        if (!host.local) {
          host.data?.current?.handleCharts(state.totalArr, findMax(state.totalArr) + 1000);
        }

        if (state.totalPointArr.length >= 20) state.totalPointArr.shift();
        state.totalPointArr.push(point);
        if (!host.local) {
          host.data?.current?.handleChartsArea(
            state.totalPointArr,
            findMax(state.totalPointArr) + 100,
          );
        }

        state.timeS = 0;
      }

      state.particles.geometry.attributes.position.needsUpdate = true;
      state.particles.geometry.attributes.color.needsUpdate = true;
      // 保留原实现的每帧重建写法，待视觉验证通过后再优化为直接复用 attribute
      state.sitGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      state.sitGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    function render() {
      sitRenew();
      if (state.controlsFlag) {
        applyDefaultControlBindings();
        state.controls.update();
      } else {
        state.controls.keys = [];
        state.controls.mouseButtons = [];
      }
      state.renderer.render(state.scene, state.camera);
    }

    function animate() {
      if (state.disposed) return;
      state.animationRequestId = requestAnimationFrame(animate);
      render();
    }

    state.api = {
      sitRenew,
      changeDataFlag() {
        state.dataFlag = true;
      },
      changeSelectFlag(value, flag) {
        state.controlsFlag = value;
        if (state.selectHelper) state.selectHelper.isShiftPressed = !value;
        if (value) {
          state.selectHelper?.onSelectOver();
          if (flag) propsRef.current.changeSelect?.({ sit: [0, 72, 0, 72] });
        }
      },
      sitData(prop) {
        const t = state.tuning;
        state.ndata1 = (prop.wsPointData || []).map((a) => (a - t.valuef1 < 0 ? 0 : a));
        state.ndata1Num = state.ndata1.reduce((a, b) => a + b, 0);
        if (state.ndata1Num < prop.valuelInit) {
          state.ndata1 = new Array(sit.num1 * sit.num2).fill(0);
        }
      },
      sitValue(prop) {
        const t = state.tuning;
        if (prop.valuej) t.valuej1 = prop.valuej;
        if (prop.valueg) t.valueg1 = prop.valueg;
        if (prop.value) t.value1 = prop.value;
        if (prop.valuel) t.valuel1 = prop.valuel;
        if (prop.valuef) t.valuef1 = prop.valuef;
        if (prop.valuelInit) t.valuelInit1 = prop.valuelInit;
        state.ndata1 = state.ndata1.map((a) => (a - t.valuef1 < 0 ? 0 : a));
        state.ndata1Num = state.ndata1.reduce((a, b) => a + b, 0);
        if (state.ndata1Num < t.valuelInit1) {
          state.ndata1 = new Array(sit.num1 * sit.num2).fill(0);
        }
      },
      backData(prop) {
        const t = state.tuning;
        state.ndata = prop.wsPointData || [];
        state.ndataNum = state.ndata.reduce((a, b) => a + b, 0);
        state.ndata = state.ndata.map((a) => (a - t.valuef2 < 0 ? 0 : a - t.valuef2));
      },
      backValue(prop) {
        const t = state.tuning;
        if (prop.valuej) t.valuej2 = prop.valuej;
        if (prop.valueg) t.valueg2 = prop.valueg;
        if (prop.value) t.value2 = prop.value;
        if (prop.valuel) t.valuel2 = prop.valuel;
        if (prop.valuef) t.valuef2 = prop.valuef;
        if (prop.valuelInit) t.valuelInit2 = prop.valuelInit;
        state.ndata = state.ndata.map((a) => (a - t.valuef2 < 0 ? 0 : a - t.valuef2));
        state.ndataNum = state.ndata.reduce((a, b) => a + b, 0);
      },
      changeGroupRotate(obj) {
        if (typeof obj?.x === 'number') state.group.rotation.x = -(obj.x * 6) / 12;
        if (typeof obj?.z === 'number') state.particles.rotation.z = (obj.z * 6) / 12;
      },
      reset() {
        state.camera.position.set(0, 200, 300);
        state.camera.rotation.set(0, 0, 0);
        state.group.rotation.x = -(Math.PI * 2) / 12;
        state.group.rotation.y = 0;
        // 位置抄自 matCol.jsx:874-876，x 与初始化时的 GROUP_ORIGIN.x 不同，
        // 属于原实现的既有行为，此处保持不变。
        state.group.position.set(-15, 150, 230);
      },
    };

    init();
    animate();

    return () => {
      state.disposed = true;
      cancelAnimationFrame(state.animationRequestId);
      clearTimeout(state.debounceTimer);

      window.removeEventListener('resize', onWindowResize);
      resizeObserver?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('keydown', onDocumentKeyDown);

      const domElement = state.renderer?.domElement;
      if (domElement) {
        domElement.removeEventListener('pointerdown', pointDown);
        domElement.removeEventListener('pointermove', pointMove);
        domElement.removeEventListener('pointerup', pointUp);
      }

      // 释放 GPU 资源。原实现完全没有这一步，每次切换场景都会泄漏
      // 一个 WebGL 上下文——浏览器对同时存活的上下文数量有硬上限。
      state.controls?.dispose?.();
      state.sitGeometry?.dispose?.();
      state.material?.dispose?.();
      state.texture?.dispose?.();
      state.scene?.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
          object.material.forEach((item) => item.dispose?.());
        } else {
          object.material?.dispose?.();
        }
      });
      state.renderer?.dispose?.();
      container.replaceChildren();

      state.scene = null;
      state.camera = null;
      state.renderer = null;
      state.controls = null;
      state.selectHelper = null;
      state.group = null;
      state.particles = null;
      state.api = null;
    };
    // 参数变化需要重建整个场景：网格尺寸决定了顶点缓冲区大小。
    // `spriteUrl` 也在里面 —— 换贴图本可以只 `texture.dispose()` 再 load 一张，
    // 但那要把 material 单拎出来管生命周期。换图不是热路径（一个消费者通常
    // 只设一次），重建整场景换来的是「这个 effect 只有一条清理路径」。
  }, [sit, back, config.separation, config.fps, config.points, spriteUrl]);

  // 命令式接口转发到当前 effect 周期内的实现。
  // 走 state.api 中转而非直接闭包，是为了让参数变化重建场景后，
  // 外部持有的 ref 仍然指向新场景，不会调用到已释放的对象。
  useImperativeHandle(refs, () => ({
    sitData: (...args) => stateRef.current.api?.sitData(...args),
    sitValue: (...args) => stateRef.current.api?.sitValue(...args),
    sitRenew: (...args) => stateRef.current.api?.sitRenew(...args),
    backData: (...args) => stateRef.current.api?.backData(...args),
    backValue: (...args) => stateRef.current.api?.backValue(...args),
    changeDataFlag: (...args) => stateRef.current.api?.changeDataFlag(...args),
    changeSelectFlag: (...args) => stateRef.current.api?.changeSelectFlag(...args),
    changeGroupRotate: (...args) => stateRef.current.api?.changeGroupRotate(...args),
    reset: (...args) => stateRef.current.api?.reset(...args),
  }), []);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 320 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 320 }} />
    </div>
  );
});

PointGridRenderer.displayName = 'PointGridRenderer';

export default PointGridRenderer;
