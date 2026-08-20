/**
 * HandPointsRenderer.jsx - 手部点云渲染器
 *
 * 由 `client/src/components/three/hand0205Point.jsx`（993 行）与
 * `hand0205Point147.jsx`（1037 行）合并而来。两份在归一化空白与注释后净差
 * **151 行**，差的全是参数与两张写死的点表 —— 所以是**一个渲染器三条预设**，
 * 不是两个渲染器（第三条 `hand0205Alt` 见 `renderers/handPoints/core/layout.js` 头部）。
 *
 * 渲染数学逐行保留，包括那些不好看的地方：`interpCentered` 往一个 `fill(1)`
 * 的跨帧数组里稀疏散点、147 那条列方向斜坡的下标差一行、`jetWhite3` 对 0 值
 * 返回白色。每一条都在 `renderers/handPoints/core/` 对应文件里点了名。
 *
 * ## 它与 `pointGrid` 的关系
 *
 * 同一族：`BufferGeometry` + `PointsMaterial` + `THREE.Points` + 精灵贴图 +
 * 框选 + `changePointRotation`。共用 `../../shared/three/{SelectionHelper,pointPick}.js`
 * 与 `../../shared/three/circle.png`。**真正新增的能力是 `ARTICULATED`** —— GLTF 手模 +
 * IMU 四元数驱动的手指关节旋转，`pointGrid` 没有对应物。
 *
 * ## 搬过来时做的结构性改动
 *
 * 1. **状态实例化。** 原文件把 `timer` / `angleFlag` / `baseQuaternion` /
 *    `baseQuaternionInv` / `ndata1` / `rotate1` / `quaternion` / `local` 放在
 *    模块作用域。四元数基准尤其要命：同页挂两块手套会互相覆盖零位。全部收进
 *    `stateRef`，四元数那份收进 `createQuaternionTracker()` 的闭包。
 * 2. **卸载清理。** 原文件的 cleanup 只有 `cancelAnimationFrame` 和一句
 *    `selectHelper?.dispose()`（而 `selectHelper` 从来没被赋过值，见第 5 条），
 *    泄漏 WebGL 上下文、几何体、材质、贴图和整个 GLTF 手模。
 * 3. **贴图。** 原来是 `TextureLoader().load('./circle.png')` —— 运行期相对
 *    URL，装进别人的项目就是 404、点云全白。改成打包资源，并开
 *    `params.pointSprite` 允许换图。与 `pointGrid` 上一轮的处理一字不差。
 * 4. **`const hand = new THREE.TextureLoader().load('./hand.jpg')` 删掉。**
 *    赋给一个再没人读的局部 `const`（原 334 行 / 147 的 382 行），也就是每次
 *    挂载白发一个 521KB 的网络请求。同样的死行在另外 10 个 three 场景组件里
 *    也有，本轮只删搬进来的这两份。
 * 5. **`TWEEN.update()` 删掉。** 原文件 import 了 `@tweenjs/tween.js` 并在
 *    `render()` 里每帧调 `update()`，但全文没有创建过任何 tween —— 是从别的
 *    组件抄过来时带上的。留着等于让本包平白多一个 peer 依赖。
 *
 * ## ⚠️ 一处「修了半个功能」，要单独说
 *
 * 原实现 `import { SelectionHelper }` 了，声明了 `selectHelper` 变量，
 * `changeBox()` 里读 `selectHelper.pointTopLeft`、`cancelSelect()` 里调
 * `selectHelper.onSelectOver()` —— **但全文没有一处给 `selectHelper` 赋值**。
 * 两个方法一旦被调用就是 `TypeError`。再往下：`sitMatrix` 恒为 `[]`，
 * `checkRectangleIntersection` 永远返回 `null`；能把 `controlsFlag` 置假的
 * `changeFlag()` 没有出现在 `useImperativeHandle` 里。**整套框选是哑的。**
 *
 * 搬进包时的处理：`new SelectionHelper(...)` 补上、`sitMatrix` 按
 * `pointGrid` 的做法用 `getPointCoordinate` 现算、`changeSelectFlag` 补进
 * 对外方法（这个名字本来就在契约里，`pointGrid` 在用）。于是 `BOX_SELECT`
 * 这条能力是真的。
 *
 * **主应用画面零变化**：没有任何调用方给手部点云传过 `changeSelectFlag`，
 * `controlsFlag` 仍恒为真，`sitIndexArr` 仍恒为空 —— `sitRenew` 里那段选中
 * 判定走的还是 `else` 分支（`jetWhite3`），和现在逐点相同。改的只是
 * 「调了会崩」变成「调了能用」。
 *
 * ## 另外三处照抄不改的原实现行为
 *
 * - **`changePointRotation` 只有 `type === 'sit'` 一支是活的。** 另两支引用
 *   `particles1` / `particlesHead`，这个文件里从来没创建过，调到就是
 *   `TypeError`。这里改成静默忽略而不是照抄崩溃 —— 与 `SelectionHelper` 里
 *   那支「不存在的 `setStartPoint`」同一种处理。
 * - **`handZero()` 把手模转到 `z = -Math.PI`**，而 `init()` 里设的是
 *   `+Math.PI`。数学上同一个朝向，写法不同，照抄。
 * - **`sitData(prop)` 里的 `rotate1 = prop.rotate` 是死赋值**（`rotate1` 全文
 *   没有读点，四元数走的是 `changeHandAngle`）。删掉，行为零变化。
 */

import * as THREE from 'three';
import { TextureLoader } from 'three';
// 两个 `.js` 都不能省：three ≥0.152 的 exports map 是 `"./examples/jsm/*"`
// 通配，不带扩展名解析失败，而本包 peer 范围写的是 `three: ">=0.127"`。
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import { SelectionHelper } from '../../shared/three/SelectionHelper.js';
import {
  checkRectIndex,
  checkRectangleIntersection,
  getPointCoordinate,
} from '../../shared/three/pointPick.js';
// 逐个模块引，不走 `../../core/index.js` 那个 barrel —— barrel 会把整个零依赖层
// 拉进这个动态 chunk，懒加载的意义就没了。与另两个渲染器同一套写法。
import { DUAL_CHANNEL_DEFAULTS, createThresholdState } from '../../../core/displayThresholds.js';
import {
  addSide, findMax, gaussBlur_1, rotate90CCW,
} from '../../../core/frameMath.js';
import { jetgGrey } from '../../../core/greyLadder.js';
import { jetWhite3 } from '../../../core/rainbowLadder.js';
import {
  POINT_TABLES,
  buildGlovesMask,
  buildHandPointMask147,
} from '../core/layout.js';
import { interpCentered, interpRamp } from '../core/pipeline.js';
import { createQuaternionTracker } from '../core/quaternion.js';
import { deriveGridSize, normalizeHandPointsParams } from '../core/params.js';
import { useDeclarativeFrame } from '../../shared/react/useDeclarativeFrame.js';
import circleUrl from '../../shared/three/circle.png';

const ALT_KEY = 18;
const CTRL_KEY = 17;
const CMD_KEY = 91;

/**
 * 点阵所在 group 的世界偏移。原实现从来没给 group 设过 position，
 * 所以是原点 —— 写成常量是为了喂给 `getPointCoordinate`（它要求这个入参）。
 */
const GROUP_ORIGIN = { x: 0, y: 0, z: 0 };

/** 渲染节流：原实现 `if (delta >= 1000 / 40)`，与 `params.fps`（统计上报的节流）无关。 */
const RENDER_INTERVAL_MS = 1000 / 40;

function disposeThreeObject(root) {
  root?.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((item) => {
      if (!item) return;
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']
        .forEach((slot) => item[slot]?.dispose?.());
      item.dispose?.();
    });
  });
}

const HandPointsRenderer = React.forwardRef((props, refs) => {
  // 按参数"内容"而非引用做记忆化：调用方常传内联字面量，
  // 依赖引用会让父组件每次渲染都重建整个 WebGL 场景。
  const paramsKey = JSON.stringify(normalizeHandPointsParams(props.params));
  const config = useMemo(() => JSON.parse(paramsKey), [paramsKey]);
  const sit = config.sit;

  // 刻意不进 `normalizeHandPointsParams` —— 那一层在 `core/`，
  // 不该知道「有一张图被打包器发出来了」这件事。
  const spriteUrl = props.params?.pointSprite || circleUrl;

  const containerRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = {
      tuning: createThresholdState(DUAL_CHANNEL_DEFAULTS),
      // 四元数基准。原实现是模块级的两个变量，同页两块手套会互相覆盖零位。
      tracker: createQuaternionTracker(),
      quaternion: new THREE.Quaternion(0, 0, 0, 1),
      ndata1: [],
      handMask: null,
      totalArr: [],
      totalPointArr: [],
      timeS: 0,
      lastRender: 0,
      controlsFlag: true,
      colSelectFlag: false,
      dataFlag: false,
      selectStartArr: [],
      selectEndArr: [],
      sitMatrix: [],
      sitIndexArr: [],
      sitIndexEndArr: [],
      debounceTimer: null,
      // three.js 对象在 init() 中填充，cleanup 中释放
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      selectHelper: null,
      group: null,
      chair: null,
      particles: null,
      sitGeometry: null,
      material: null,
      texture: null,
      positions: null,
      colors: null,
      scales: null,
      bigArr: null,
      bigArrhand: null,
      bigArrg: null,
      bigArrshand: null,
      smoothBig: null,
      animationRequestId: null,
      disposed: false,
      api: null,
    };
  }

  useEffect(() => {
    const state = stateRef.current;
    const container = containerRef.current;
    if (!container) return undefined;
    let resizeObserver = null;
    let effectDisposed = false;

    const { amountX: AMOUNTX, amountY: AMOUNTY } = deriveGridSize(sit);
    const SEPARATION = config.separation;
    const renderT = 1 / config.fps;
    const clock = new THREE.Clock();
    const gridTotal = AMOUNTX * AMOUNTY;
    const interpTotal = sit.num1 * sit.interp * sit.num2 * sit.interp;

    state.disposed = false;
    state.ndata1 = new Array(sit.num1 * sit.num2).fill(0);
    // ⚠️ 这两个的初值是 **1** 不是 0，而 `interpCentered` 只覆盖稀疏格点 ——
    // 没被覆盖的格子会永远保持 1 并一路走进高斯模糊。原实现如此，见
    // `renderers/handPoints/core/pipeline.js` 第 1 条。`interpRamp` 那条自己 new 数组，
    // 这两个就闲置着。
    state.bigArr = new Array(interpTotal).fill(1);
    state.bigArrhand = new Array(interpTotal).fill(1);
    state.bigArrg = new Array(gridTotal).fill(1);
    state.bigArrshand = new Array(gridTotal).fill(1);
    state.smoothBig = new Array(gridTotal).fill(1);
    state.lastRender = 0;

    // 手形掩码。**原实现每帧都重算一遍**（`sitRenew()` 开头的
    // `initndata1Data()`）—— 它只依赖写死的点表，结果逐帧完全相同。
    // 这里挪到建场景时算一次，画面零变化，省掉每帧 100~155 次的循环。
    const pointTable = POINT_TABLES[config.pointTable];
    state.handMask = config.maskMode === 'hand147'
      ? buildHandPointMask147(pointTable, sit.num1)
      : buildGlovesMask(pointTable, rotate90CCW, sit.num1);

    /** 防抖。原实现用模块级 timer，多实例会互相打断。 */
    function debounce(fn, time) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(fn, time);
    }

    /** 点阵当前在屏幕上占的矩形。框选判定的基准，原实现漏了这一步（见文件头）。 */
    function refreshSitMatrix() {
      if (!state.particles || !state.camera) return;
      const sitArr = getPointCoordinate({
        particles: state.particles,
        camera: state.camera,
        position: GROUP_ORIGIN,
      });
      state.sitMatrix = [sitArr[0].x, sitArr[0].y, sitArr[1].x, sitArr[1].y];
    }

    function pointDown(event) {
      if (!state.selectHelper?.isShiftPressed) return;
      state.sitIndexArr = [];
      state.selectStartArr = [event.clientX, event.clientY];
      refreshSitMatrix();
      state.colSelectFlag = true;
    }

    function pointMove(event) {
      if (!state.selectHelper?.isShiftPressed || !state.colSelectFlag) return;
      state.selectEndArr = [event.clientX, event.clientY];
      const [startX, startY] = state.selectStartArr;
      const [endX, endY] = state.selectEndArr;

      const width = Math.abs(Math.round(endX - startX));
      const height = Math.abs(Math.round(endY - startY));

      if (state.controlsFlag) return;

      const selectRect = [
        Math.min(startX, endX),
        Math.min(startY, endY),
        Math.max(startX, endX),
        Math.max(startY, endY),
      ];
      const sitInterArr = checkRectangleIntersection(selectRect, state.sitMatrix);
      if (sitInterArr) {
        state.sitIndexArr = checkRectIndex(state.sitMatrix, sitInterArr, AMOUNTX, AMOUNTY);
        state.sitIndexEndArr = [...state.sitIndexArr];
      }

      propsRef.current.changeStateData?.({ width, height });
    }

    function pointUp() {
      if (!state.selectHelper?.isShiftPressed) return;
      propsRef.current.changeSelect?.({ sit: state.sitIndexEndArr });
      state.selectStartArr = [];
      state.selectEndArr = [];
      state.colSelectFlag = false;
    }

    /** 恢复 TrackballControls 的默认按键映射，抄自 hand0205Point.jsx:716-725 */
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

    /** 构建点阵几何体，抄自 hand0205Point.jsx:301-362 */
    function initSet() {
      const numParticles = AMOUNTX * AMOUNTY;
      state.positions = new Float32Array(numParticles * 3);
      state.scales = new Float32Array(numParticles);
      state.colors = new Float32Array(numParticles * 3);

      let i = 0;
      let j = 0;
      for (let ix = 0; ix < AMOUNTX; ix += 1) {
        for (let iy = 0; iy < AMOUNTY; iy += 1) {
          state.positions[i] = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2 + ix * 20;
          state.positions[i + 1] = 0;
          state.positions[i + 2] = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
          state.scales[j] = 1;
          state.colors[i] = 0 / 255;
          state.colors[i + 1] = 0 / 255;
          state.colors[i + 2] = 255 / 255;
          i += 3;
          j += 1;
        }
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
        size: config.pointSize,
      });

      state.particles = new THREE.Points(state.sitGeometry, state.material);
      state.particles.scale.set(...config.particleScale);
      state.particles.position.set(...config.particlePosition);
      // 原实现先 `rotation.x = 0` 再在两行后覆盖成 `Math.PI`，净效果就是这一句。
      state.particles.rotation.z = config.rotationZ;
      state.particles.rotation.x = config.rotationX;
      state.group.add(state.particles);
      state.group.quaternion.set(0, 0, 0, 1);
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
      state.camera.position.set(0, 30, -10);
      state.camera.lookAt(0, 0, 0);

      state.scene = new THREE.Scene();
      state.scene.add(state.group);

      // 手模。`modelUrl` 是**运行期相对 URL**（主应用是 `client/public/model/`），
      // 不是打包资源 —— 它 4MB 起步，进不了 npm 包。消费者得自己把 glb 放到
      // 站点上并传路径进来；传空串就只剩点云，关节命令随之变成空操作。
      if (config.modelUrl) {
        const loader = new GLTFLoader();
        loader.load(config.modelUrl, (gltf) => {
          if (effectDisposed) {
            disposeThreeObject(gltf.scene);
            return;
          }
          state.chair = gltf.scene;
          state.chair.rotation.x = 0;
          state.chair.rotation.z = config.rotationZ;
          state.group.add(state.chair);
        });
      }

      const helper = new THREE.GridHelper(2000, 100);
      helper.position.y = -199;
      helper.material.opacity = 0.25;
      helper.material.transparent = true;
      state.scene.add(helper);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff);
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
      state.renderer.setClearColor(0x10152b);
      container.replaceChildren(state.renderer.domElement);

      state.controls = new TrackballControls(state.camera, state.renderer.domElement);
      state.controls.dynamicDampingFactor = 1;
      state.controls.domElement = container;
      applyDefaultControlBindings();

      // 原实现漏了这一句，于是 `changeBox` / `cancelSelect` 一调就崩。见文件头。
      state.selectHelper = new SelectionHelper(state.renderer, state.controls, 'selectBox');

      initSet();

      window.addEventListener('resize', onWindowResize);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(onWindowResize);
        resizeObserver.observe(container);
      }
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      state.renderer.domElement.addEventListener('pointerdown', pointDown);
      state.renderer.domElement.addEventListener('pointermove', pointMove);
      state.renderer.domElement.addEventListener('pointerup', pointUp);
    }

    /** 五指骨骼旋转，抄自 hand0205Point.jsx:365-418，骨骼名改为参数。 */
    function rotateFingers(arr) {
      if (!state.chair || !Array.isArray(arr)) return;
      state.chair.traverse((obj) => {
        if (!obj.isSkinnedMesh) return;
        config.fingerBones.forEach((names, index) => {
          const value = arr[index];
          names.forEach((name) => {
            const bone = obj.skeleton.getBoneByName(name);
            // 取不到的骨骼静默跳过 —— 原实现用的是 `if (a)`，同样的守卫。
            if (bone) bone.rotation.z = config.fingerRotationScale * value;
          });
        });
      });
    }

    /**
     * 把一帧压力数据与手形掩码走同一条管线，再写进顶点缓冲。
     * 抄自 hand0205Point.jsx:557-708 与 hand0205Point147.jsx:582-733，
     * 两者的差异全部由 `config` 表达。
     */
    function sitRenew() {
      if (state.disposed || !state.particles) return;
      const t = state.tuning;

      if (state.tracker.hasBase()) state.group.quaternion.copy(state.quaternion);

      let bigArr;
      let bigArrhand;
      if (config.interpMode === 'ramp') {
        bigArr = interpRamp(state.ndata1, sit.num2, sit.num1, sit.interp, sit.interp);
        bigArrhand = interpRamp(state.handMask, sit.num2, sit.num1, sit.interp, sit.interp);
      } else {
        // 就地写进跨帧复用的数组，见上面 `fill(1)` 那段注释。
        interpCentered(state.ndata1, state.bigArr, sit.num1, sit.interp);
        interpCentered(state.handMask, state.bigArrhand, sit.num1, sit.interp);
        bigArr = state.bigArr;
        bigArrhand = state.bigArrhand;
      }

      const padded = addSide(
        bigArr, sit.num2 * sit.interp, sit.num1 * sit.interp, sit.order, sit.order,
      );
      const paddedMask = addSide(
        bigArrhand, sit.num2 * sit.interp, sit.num1 * sit.interp, sit.order, sit.order,
      );
      gaussBlur_1(paddedMask, state.bigArrshand, AMOUNTY, AMOUNTX, config.maskBlur);
      gaussBlur_1(padded, state.bigArrg, AMOUNTY, AMOUNTX, t.valueg1);

      const {
        positions, colors, smoothBig, bigArrg, bigArrshand, sitIndexArr,
      } = state;
      const hasSelection = sitIndexArr && sitIndexArr.length > 0
        && !sitIndexArr.every((a) => a === 0);

      let k = 0;
      let l = 0;
      let dataArr = [];
      for (let ix = 0; ix < AMOUNTX; ix += 1) {
        for (let iy = 0; iy < AMOUNTY; iy += 1) {
          const value = bigArrg[l] * 10;
          const valuehand = bigArrshand[l] * 10;
          smoothBig[l] = smoothBig[l] + (value - smoothBig[l] + 0.5) / t.valuel1;

          positions[k] = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
          positions[k + 1] = smoothBig[l] * t.value1;
          positions[k + 2] = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;

          // ⚠️ 两条预设判「这个点是不是手」用的不是同一个量：`hand0205` 看掩码
          // （`valuehand`），147 看压力（`value`）—— 也就是 147 那条上掩码算了
          // 一整套却没参与判定。原实现如此，做成开关保留，见
          // `renderers/handPoints/core/params.js` 头部那段警告。
          const hideProbe = config.maskSource === 'value' ? value : valuehand;
          if (hideProbe < config.maskThreshold) {
            positions[k + 1] = config.hiddenY;
            positions[k] = 0;
            positions[k + 2] = 0;
          }

          let rgb;
          if (hasSelection) {
            const inside = ix >= sitIndexArr[0] && ix < sitIndexArr[1]
              && iy >= sitIndexArr[2] && iy < sitIndexArr[3];
            if (inside) {
              rgb = jetWhite3(0, t.valuej1, smoothBig[l]);
              dataArr.push(bigArrg[l]);
            } else {
              rgb = jetgGrey(0, t.valuej1, smoothBig[l]);
            }
          } else {
            rgb = jetWhite3(0, t.valuej1, smoothBig[l]);
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
      // 保留原实现的每帧重建写法，待视觉验证通过后再优化为直接复用 attribute。
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

    /** 原实现把渲染节流到 40fps（`if (delta >= 1000 / 40)`），照抄。 */
    function animate(timestamp) {
      if (state.disposed) return;
      state.animationRequestId = requestAnimationFrame(animate);
      if (timestamp - state.lastRender >= RENDER_INTERVAL_MS) {
        render();
        state.lastRender = timestamp;
      }
    }

    state.api = {
      sitRenew,
      changeDataFlag() {
        // 原实现里 `dataFlag` 只写不读。留着是因为契约声明了这个方法，
        // 宿主 `page/home/util.js` 对所有展示形式一视同仁地调它。
        state.dataFlag = true;
      },
      sitData(prop) {
        const t = state.tuning;
        let ndata1 = (prop.wsPointData || []).map((a) => (a - t.valuef1 < 0 ? 0 : a));
        const total = ndata1.reduce((a, b) => a + b, 0);
        // 注意阈值取的是**入参**的 `valuelInit` 而不是 `t.valuelInit1`，
        // 与 `pointGrid` 的 `sitData` 一致，都是原实现的写法。
        if (total < prop.valuelInit) {
          ndata1 = new Array(sit.num1 * sit.num2).fill(0);
        }
        state.ndata1 = ndata1;
      },
      sitValue(prop) {
        const t = state.tuning;
        if (prop.valuej) t.valuej1 = prop.valuej;
        if (prop.valueg) t.valueg1 = prop.valueg;
        if (prop.value) t.value1 = prop.value;
        if (prop.valuel) t.valuel1 = prop.valuel;
        if (prop.valuef) t.valuef1 = prop.valuef;
        if (prop.valuelInit) t.valuelInit1 = prop.valuelInit;
      },
      changeHandAngle(arr) {
        if (!Array.isArray(arr) || arr.length < 4) return;
        state.quaternion = new THREE.Quaternion(...state.tracker.transform(arr));
      },
      calibration(arr) {
        rotateFingers(arr);
      },
      handZero() {
        // 原实现设的是 `-Math.PI`，而 init 里是 `+Math.PI`。同一个朝向，照抄。
        if (state.chair) state.chair.rotation.set(0, 0, -config.rotationZ);
        state.quaternion = new THREE.Quaternion(0, 0, 0, 1);
      },
      resetHand() {
        // 清掉四元数基准，下一帧重新取零位。
        state.tracker.reset();
      },
      changaCamera(obj) {
        // 原拼写如此（camera 少一个 e），契约里也是这个名字，不改。
        // 三个分支都是 `if (x)` 而不是 `!= null` —— 传 0 不生效，原行为。
        const { x, y, z } = obj || {};
        if (x) state.camera.position.x = x;
        if (y) state.camera.position.y = y;
        if (z) state.camera.position.z = z;
      },
      changePointRotation({ direction, value, type }) {
        // 原实现另有 `back` / `head` 两支，引用的 `particles1` / `particlesHead`
        // 在这个文件里从来没创建过，调到就是 TypeError。这里静默忽略。
        if (type !== 'sit' || !state.particles) return;
        if (direction === 'x') {
          state.particles.rotation.x = Math.PI / 3 - (value * 6) / 12;
        } else {
          state.particles.rotation[direction] = (value * 6) / 12;
        }
      },
      changeSelectFlag(value, flag) {
        // `pointGrid` 已有的同名方法。原实现里对应的 `changeFlag()` 没有出现在
        // `useImperativeHandle` 里，所以 `controlsFlag` 恒为真、框选恒为哑的。
        state.controlsFlag = value;
        if (state.selectHelper) state.selectHelper.isShiftPressed = !value;
        if (value) {
          state.selectHelper?.onSelectOver();
          if (flag) propsRef.current.changeSelect?.({ sit: [0, AMOUNTX, 0, AMOUNTY] });
        }
      },
      changeBox({ width, height }) {
        const helperEl = state.selectHelper?.element;
        if (!helperEl) return;

        const left = state.selectHelper.pointTopLeft.x || window.innerWidth / 2;
        const top = state.selectHelper.pointTopLeft.y || window.innerHeight / 2;
        helperEl.style.left = `${left}px`;
        helperEl.style.top = `${top}px`;
        if (width) helperEl.style.width = `${width}px`;
        if (height) helperEl.style.height = `${height}px`;

        if (state.controlsFlag) return;

        // 原实现这里读的是恒为空的 `sitMatrix`，于是交集永远是 null。
        refreshSitMatrix();
        const selectRect = [
          Math.min(left, left + Number(width)),
          Math.min(top, top + Number(height)),
          Math.max(left, left + Number(width)),
          Math.max(top, top + Number(height)),
        ];
        const sitInterArr = checkRectangleIntersection(selectRect, state.sitMatrix);
        if (sitInterArr) {
          state.sitIndexArr = checkRectIndex(state.sitMatrix, sitInterArr, AMOUNTX, AMOUNTY);
        }
        debounce(() => {
          propsRef.current.changeSelect?.({ sit: state.sitIndexArr });
        }, 500);
      },
      cancelSelect() {
        state.selectHelper?.onSelectOver();
        state.sitIndexArr = [];
        state.sitIndexEndArr = [];
      },
    };

    init();
    animate(0);

    return () => {
      effectDisposed = true;
      state.disposed = true;
      cancelAnimationFrame(state.animationRequestId);
      clearTimeout(state.debounceTimer);

      window.removeEventListener('resize', onWindowResize);
      resizeObserver?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);

      const domElement = state.renderer?.domElement;
      if (domElement) {
        domElement.removeEventListener('pointerdown', pointDown);
        domElement.removeEventListener('pointermove', pointMove);
        domElement.removeEventListener('pointerup', pointUp);
      }
      state.selectHelper?.dispose?.();
      state.selectHelper?.onSelectOver?.();

      // 释放 GPU 资源。原实现完全没有这一步 —— 每切一次展示形式泄漏一个
      // WebGL 上下文外加整个 GLTF 手模，而浏览器对同时存活的上下文有硬上限。
      state.controls?.dispose?.();
      state.sitGeometry?.dispose?.();
      state.material?.dispose?.();
      state.texture?.dispose?.();
      disposeThreeObject(state.scene);
      state.renderer?.dispose?.();
      container.replaceChildren();

      state.scene = null;
      state.camera = null;
      state.renderer = null;
      state.controls = null;
      state.selectHelper = null;
      state.group = null;
      state.chair = null;
      state.particles = null;
      state.api = null;
    };
    // 参数变化重建整个场景：网格尺寸决定顶点缓冲区大小，点表决定掩码。
    // `config` 是按 `paramsKey`（内容）记忆化的，所以只有参数真变了才重建。
  }, [config, spriteUrl]);

  // 命令式接口转发到当前 effect 周期内的实现。走 state.api 中转而非直接闭包，
  // 是为了让参数变化重建场景后，外部持有的 ref 仍指向新场景。
  useImperativeHandle(refs, () => ({
    sitData: (...a) => stateRef.current.api?.sitData(...a),
    sitValue: (...a) => stateRef.current.api?.sitValue(...a),
    sitRenew: (...a) => stateRef.current.api?.sitRenew(...a),
    changeDataFlag: (...a) => stateRef.current.api?.changeDataFlag(...a),
    changeHandAngle: (...a) => stateRef.current.api?.changeHandAngle(...a),
    calibration: (...a) => stateRef.current.api?.calibration(...a),
    handZero: (...a) => stateRef.current.api?.handZero(...a),
    resetHand: (...a) => stateRef.current.api?.resetHand(...a),
    changaCamera: (...a) => stateRef.current.api?.changaCamera(...a),
    changePointRotation: (...a) => stateRef.current.api?.changePointRotation(...a),
    changeSelectFlag: (...a) => stateRef.current.api?.changeSelectFlag(...a),
    changeBox: (...a) => stateRef.current.api?.changeBox(...a),
    cancelSelect: (...a) => stateRef.current.api?.cancelSelect(...a),
  }), []);

  // 声明式帧入口。`pointSprite` 在 `normalizeHandPointsParams` 的返回里，
  // 所以 `paramsKey` 已经覆盖了 `spriteUrl`，不必像 pointGrid 那样再拼一层。
  useDeclarativeFrame(props.frame, (payload) => {
    stateRef.current.api?.sitData(payload);
  }, paramsKey);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 320 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 320 }} />
    </div>
  );
});

HandPointsRenderer.displayName = 'HandPointsRenderer';

export default HandPointsRenderer;
