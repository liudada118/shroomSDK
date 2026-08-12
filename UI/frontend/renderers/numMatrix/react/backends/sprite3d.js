/**
 * sprite3d.js - 数字矩阵的精灵图后端（three.js InstancedMesh）
 *
 * 由 `components/three/NumThreeColor1024.jsx` 机械变换而来，另外两份
 * （`NumThreeColor copy.jsx` 的 Fast256、`NumThreeColor1024sit.jsx` 的
 * Fast1024sit）的差异已收敛成 `params.js` 里的参数 —— 三份的布局公式代数
 * 等价，证明见 `../pipeline.test.js`。
 *
 * 画法：把 0..max 每个整数烘成一格 32×32 的画布（背景走配色、白字、黑框），
 * 整张当 `CanvasTexture`，然后 `InstancedMesh` 每个实例只改 `uvOffset`
 * 取对应那一格。所以显示一千个数字只有一次 draw call，代价是换配色要重烘纹理。
 *
 * ## 五处结构性改动（渲染数学一行没动）
 *
 * 1. **模块级状态收进实例。** 原文件的 `ndata1` / `animationRequestId` /
 *    `materialRef` 是模块级，两个实例同时存在就会互相踩：后挂载的那个把
 *    `materialRef` 覆盖掉，先挂载的那个从此换配色无效；`animationRequestId`
 *    被覆盖后先挂载的动画循环永远停不下来。
 *
 * 2. **逐帧不再重建 BufferAttribute。** 原文件在**逐实例的内层循环里**调
 *    `geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(...))`
 *    —— 1024 个实例 × 2 个属性 × 60fps ≈ 每秒 12 万个临时对象。属性包的是
 *    同一个 `Float32Array`，而 GPU 上传发生在 `render()`，所以建一次、每帧
 *    只置 `needsUpdate` 的出图逐像素相同。
 *
 * 3. **实例矩阵只在建场景时算一次。** 原文件每帧重跑 `setMatrixAt`，但从没置
 *    `instanceMatrix.needsUpdate`，所以那遍循环的结果根本没上传过 GPU —— 画面
 *    用的一直是首帧那次上传。位置本身是静态的（坐标表也不会逐帧变），
 *    所以搬到循环外出图相同，省掉每帧 1024 次矩阵合成。
 *
 * 4. **补卸载清理。** 原文件只 `cancelAnimationFrame` + 摘监听器，泄漏 WebGL
 *    上下文、geometry、material、texture。浏览器对同时存活的上下文数量有硬
 *    上限（约 16 个），反复切展示形式会到顶然后整个页面黑掉。
 *
 * 5. **容器由外部传入，不再 `document.querySelector('.canvasNum')`。**
 *    全局选择器让两个实例抢同一个 div。
 *
 * 另有三处小订正，都只在原实现本就异常的输入上有差别：
 * - `d` 一律走 `clampTextureValue`。Fast1024sit 原来直接用 `data[i]`，
 *   数据超过 255 时 uvOffset 落到纹理外，那一格显示成别的数字。
 * - `Math.max(...res)` 换成循环。65536 点的矩阵上 spread 会爆栈。
 * - 摘掉每帧一次的 `console.log('分压')` 与从未挂上 DOM 的 `Stats` 面板。
 */

import * as THREE from 'three';

import { jet, press } from '../../../../core/frameMath.js';
import { isClassicColormap, sampleColormapRgb } from '../../../../core/colormaps.js';
import { TEXTURE_CELL_SIZE } from '../../core/params.js';
import {
  cellUvOffset,
  clampTextureValue,
  classicTint,
  deriveCellPlaneSize,
  formatDisplayValue,
  getTextureCanvasSize,
  getTextureFontSize,
  getTextureRange,
  instanceWorldPosition,
  quantizeFrame,
  resolveCanvasSize,
} from '../../core/pipeline.js';

/** 顶点着色器，逐字抄自 `NumThreeColor1024.jsx:385-396`。 */
const VERTEX_SHADER = `
  attribute vec3 instanceColor;
  varying vec3 vColor;
  attribute vec2 uvOffset;
  uniform vec2 tileSize;
  varying vec2 vUv;
  void main() {
    vUv = uv * tileSize + uvOffset;
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/**
 * 片元着色器，逐字抄自 `NumThreeColor1024.jsx:397-416`。
 *
 * `pow(color * 1.5, 1/2.2)` 那句不是标准的 sRGB 变换（多了 1.5 倍的提亮），
 * 但它决定了这个展示形式现在的观感，改了就是界面变化。别动。
 */
const FRAGMENT_SHADER = `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vColor;

  vec3 linearToSRGB(vec3 color) {
    return pow(color * 1.5, vec3(1.0 / 2.2));
  }

  void main() {
    vec4 texColor = texture2D(map, vUv);
    if (texColor.a < 0.1) discard;

    vec3 rgb = texColor.rgb * vColor;
    rgb = linearToSRGB(rgb);
    gl_FragColor = vec4(rgb, texColor.a);
  }
`;

/** 相机缩放范围与步长，抄自 `NumThreeColor1024.jsx:309-311`。 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.1;

/** 建场景时先给每格填的占位数字，抄自 `NumThreeColor1024.jsx:467`。 */
const PLACEHOLDER_VALUE = 20;

/**
 * 算一格精灵图的背景色。
 *
 * 抄自 `NumThreeColor1024.jsx:42-45`。`classic` 与不传配色都必须走原来的
 * jet，让老展示系统的观感一个像素都不变；只有显式选了别的配色才换成色标采样。
 *
 * @param {{id: string, reverse: boolean}} colormap 当前配色，缺省即 classic。
 * @param {number} displayValue 这一格代表的实际数值。
 * @param {number} colorMax 映射到色标顶端的数值。
 * @returns {number[]} 0-255 的 rgb 三元组。
 */
function sampleCellRgb(colormap, displayValue, colorMax) {
  if (isClassicColormap(colormap)) return jet(0, colorMax, displayValue);
  return sampleColormapRgb(colormap.id, colorMax > 0 ? displayValue / colorMax : 0, colormap);
}

/**
 * 求最大值及其下标。
 *
 * 换掉原实现的 `Math.max(...res)` + `res.indexOf(max)`：spread 在
 * 65536 点的矩阵上会超参数个数上限直接抛栈溢出，而且 indexOf 是第二遍遍历。
 * 非空数组上结果与原写法完全相同（都取第一个最大值）。
 *
 * @param {number[]} values 数值数组。
 * @returns {{max: number, index: number}} 最大值与它的下标；空数组给 -1。
 */
function findPeak(values) {
  let max = -Infinity;
  let index = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > max) {
      max = values[i];
      index = i;
    }
  }
  return { max, index };
}

/**
 * 烘一张数字精灵图。
 *
 * 逐字搬自 `NumThreeColor1024.jsx:240-283`，含四个纹理参数
 * （`flipY = false` 配合 `mesh.rotation.x = Math.PI` 才是正的、
 * 关 mipmap 与 `NearestFilter` 让数字边缘不糊）。
 *
 * @param {object} options 烘制参数。
 * @param {number} options.colorMaxInput 色标顶端数值（即 valuej）；<=0 时退回 30。
 * @param {number} options.textureValueMax 精灵图要覆盖的最大数值。
 * @param {number} options.decimalScale 定点倍率。
 * @param {object} options.colormap 当前配色。
 * @returns {THREE.CanvasTexture} 精灵图纹理。
 */
function bakeDigitSpriteSheet({ colorMaxInput, textureValueMax, decimalScale, colormap }) {
  const range = getTextureRange(textureValueMax);
  const { width, height } = getTextureCanvasSize(range);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // 原实现的 `(maxVal && maxVal > 0) ? maxVal : 30`。Fast1024sit 是唯一写死
  // 传 30 的（所以它的颜色滑块不生效），由 retintOnThresholdChange 参数区分。
  const colorMax = colorMaxInput && colorMaxInput > 0 ? colorMaxInput : 30;

  ctx.font = `bold ${getTextureFontSize(range.max, decimalScale)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= range.max; i += 1) {
    const cx = (i % range.cols) * TEXTURE_CELL_SIZE;
    const cy = Math.floor(i / range.cols) * TEXTURE_CELL_SIZE;

    const [r, g, b] = sampleCellRgb(colormap, i / decimalScale, colorMax);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(cx, cy, TEXTURE_CELL_SIZE, TEXTURE_CELL_SIZE);

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, TEXTURE_CELL_SIZE, TEXTURE_CELL_SIZE);

    ctx.fillStyle = 'white';
    ctx.fillText(
      formatDisplayValue(i, decimalScale),
      cx + TEXTURE_CELL_SIZE / 2,
      cy + TEXTURE_CELL_SIZE / 2,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

/**
 * 创建精灵图后端。
 *
 * 后端只管画，不碰阈值来源、不碰侧栏统计 —— 那两件事在
 * `NumMatrixRenderer.jsx` 里，这样换后端（canvas2d / webgl）时那部分不用重写。
 *
 * @param {object} options 创建参数。
 * @param {HTMLElement} options.container 挂 canvas 的容器。
 * @param {object} options.config 归一化后的渲染器参数。
 * @param {{gridWidth: number, gridHeight: number}} options.grid 网格尺寸。
 * @param {object|null} options.coordinateLayout `buildCoordinateWorldLayout` 的结果。
 * @param {object} options.colormap 当前配色。
 * @param {object} options.tuning 实例私有的阈值对象（含 valuef1 / valuej1 / valuep / valueprop）。
 * @param {(index: number) => void} [options.onPeak] 每帧回调最大值所在的点位序号（从 1 开始）。
 * @returns {object} 后端实例。
 */
export function createSpriteMatrixBackend({
  container,
  config,
  grid,
  coordinateLayout,
  colormap,
  tuning,
  onPeak,
}) {
  const coordinatePoints = coordinateLayout?.points || null;
  const worldCellSize = coordinateLayout?.worldCellSize
    || 2 / Math.max(grid.gridWidth, grid.gridHeight);
  const count = coordinatePoints?.length || grid.gridWidth * grid.gridHeight;

  const decimalScale = config.decimalScale;
  // 原实现：`props.textureValueMax || (decimalScale > 1 ? valuej1 * decimalScale : 255)`。
  const resolveTextureMax = () => (
    config.textureValueMax
    || (decimalScale > 1 ? tuning.valuej1 * decimalScale : 255)
  );
  let textureRange = getTextureRange(resolveTextureMax());

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const canvasSize = resolveCanvasSize(window.innerHeight, config.canvasHeightRatio);
  renderer.setSize(canvasSize, canvasSize);
  renderer.toneMapping = THREE.NoToneMapping;
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  camera.position.z = 1000;

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  const texture = bakeDigitSpriteSheet({
    colorMaxInput: config.retintOnThresholdChange ? tuning.valuej1 : 0,
    textureValueMax: textureRange.max,
    decimalScale,
    colormap,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      tileSize: { value: new THREE.Vector2(1.0 / textureRange.cols, 1.0 / textureRange.rows) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
  material.toneMapped = false;

  const cellPlaneSize = deriveCellPlaneSize(worldCellSize);
  const geometry = new THREE.PlaneGeometry(cellPlaneSize, cellPlaneSize);
  const uvOffsets = new Float32Array(count * 2);
  const colorArray = new Float32Array(count * 3);
  // 非 classic 配色的 tint 恒为白色，填一次即可，逐帧不再重算 —— 否则会把
  // 色标压暗，用户看到的就不是他挑的那条色带了。
  const useClassicTint = isClassicColormap(colormap);
  if (!useClassicTint) colorArray.fill(1);

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();

  // 实例矩阵只算一次（见文件头第 3 条）。有坐标表时用物理坐标，
  // 否则退回规则矩阵布局。
  for (let i = 0; i < count; i += 1) {
    const coordinatePoint = coordinatePoints?.[i];
    if (coordinatePoint) {
      dummy.position.set(coordinatePoint.worldX, coordinatePoint.worldY, 0);
    } else {
      const { x, y } = instanceWorldPosition(i, grid.gridWidth, grid.gridHeight, worldCellSize);
      dummy.position.set(x, y, 0);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const [u, v] = cellUvOffset(PLACEHOLDER_VALUE, textureRange);
    uvOffsets[i * 2] = u;
    uvOffsets[i * 2 + 1] = v;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.rotation.x = Math.PI;

  // 属性建一次，逐帧只置 needsUpdate（见文件头第 2 条）。
  const uvAttribute = new THREE.InstancedBufferAttribute(uvOffsets, 2);
  const colorAttribute = new THREE.InstancedBufferAttribute(colorArray, 3);
  geometry.setAttribute('uvOffset', uvAttribute);
  geometry.setAttribute('instanceColor', colorAttribute);
  scene.add(mesh);

  // ---- 缩放与拖拽（Fast1024sit 没有，由 cameraControls 参数控制）----
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const mouse = new THREE.Vector2();
  const beforeZoom = new THREE.Vector3();
  const afterZoom = new THREE.Vector3();
  const lastDrag = new THREE.Vector2();
  let isDragging = false;

  const getWorldPoint = (event, target) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster.ray.intersectPlane(plane, target);
  };

  const onWheel = (event) => {
    event.preventDefault();
    if (!getWorldPoint(event, beforeZoom)) return;
    const scale = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const nextZoom = THREE.MathUtils.clamp(camera.zoom * scale, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === camera.zoom) return;
    camera.zoom = nextZoom;
    camera.updateProjectionMatrix();
    if (!getWorldPoint(event, afterZoom)) return;
    // 缩放前后同一个屏幕点对应的世界坐标之差，就是要补的位移 ——
    // 这样鼠标底下那一格不动，缩放感觉是"以光标为中心"。
    camera.position.add(beforeZoom.sub(afterZoom));
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    isDragging = true;
    lastDrag.set(event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!isDragging) return;
    const dx = event.clientX - lastDrag.x;
    const dy = event.clientY - lastDrag.y;
    lastDrag.set(event.clientX, event.clientY);
    const rect = canvas.getBoundingClientRect();
    const worldPerPixelX = (camera.right - camera.left) / (rect.width * camera.zoom);
    const worldPerPixelY = (camera.top - camera.bottom) / (rect.height * camera.zoom);
    camera.position.x -= dx * worldPerPixelX;
    camera.position.y += dy * worldPerPixelY;
  };

  const onPointerUp = (event) => {
    if (!isDragging) return;
    isDragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const pointerEvents = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointerleave', onPointerUp],
    ['pointercancel', onPointerUp],
  ];

  if (config.cameraControls) {
    canvas.addEventListener('wheel', onWheel, { passive: false });
    pointerEvents.forEach(([name, handler]) => canvas.addEventListener(name, handler));
  }

  // ---- 帧循环 ----
  let frame = new Array(count).fill(0);
  let animationRequestId = null;
  let disposed = false;

  function drawFrame() {
    let source = frame;
    // 分压重分配。原实现的双层 `!= 0` 守卫照抄：valuep 或 valueprop 为 0
    // 时整段跳过，用原始帧。只有 Fast1024sit 开这个开关。
    const redistribution = config.pressureRedistribution;
    if (redistribution.enabled && tuning.valuep !== 0 && tuning.valueprop !== 0) {
      // `press(arr, width, height, ...)` 的前两个尺寸参数是宽、高，所以
      // cols 在前。原实现传的是 (23, 23)，两者同值看不出顺序，这里按语义排。
      source = press(
        source,
        redistribution.cols,
        redistribution.rows,
        tuning.valuep,
        tuning.valueprop,
        redistribution.axis,
      );
    }

    const data = quantizeFrame(source, tuning.valuef1, decimalScale);
    const peak = findPeak(data);
    onPeak?.(peak.index + 1);

    for (let i = 0; i < count; i += 1) {
      const dataIndex = coordinatePoints?.[i]?.index ?? i;
      const d = clampTextureValue(data[dataIndex] * decimalScale, textureRange.max);
      const [u, v] = cellUvOffset(d, textureRange);
      uvOffsets[i * 2] = u;
      uvOffsets[i * 2 + 1] = v;

      if (useClassicTint) {
        const [r, g, b] = classicTint(d, textureRange.max);
        colorArray[i * 3 + 0] = r;
        colorArray[i * 3 + 1] = g;
        colorArray[i * 3 + 2] = b;
      }
    }

    uvAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function animate() {
    if (disposed) return;
    animationRequestId = requestAnimationFrame(animate);
    drawFrame();
  }

  return {
    /**
     * 收一帧数据。只存不画，画由帧循环驱动 —— 与原实现一致
     * （原实现也是 sitData 写模块级 ndata1、animate 里读）。
     *
     * @param {number[]} nextFrame 已按下限过滤的帧。
     */
    setFrame(nextFrame) {
      if (Array.isArray(nextFrame)) frame = nextFrame;
    },

    /**
     * 阈值变化后重烘精灵图。
     *
     * `retintOnThresholdChange` 为假时什么都不做 —— Fast1024sit 的原行为
     * 就是纹理写死 `jet(0, 30)`、拖颜色滑块画面不动。
     */
    retint() {
      if (disposed || !config.retintOnThresholdChange) return;
      const nextRange = getTextureRange(resolveTextureMax());
      const nextTexture = bakeDigitSpriteSheet({
        colorMaxInput: tuning.valuej1,
        textureValueMax: nextRange.max,
        decimalScale,
        colormap,
      });
      // 换纹理前先释放旧的：原实现每拖一下滑块就丢一张
      // 512×512（12 位数据是 1024×2560）的纹理给 GC，且 GPU 侧要等
      // three.js 的 WebGLTextures 缓存被动清理。
      material.uniforms.map.value?.dispose?.();
      material.uniforms.map.value = nextTexture;
      material.uniforms.tileSize.value.set(1.0 / nextRange.cols, 1.0 / nextRange.rows);
      textureRange = nextRange;
    },

    /** 启动帧循环。 */
    start() {
      if (disposed || animationRequestId !== null) return;
      animate();
    },

    /** 释放全部 GPU 资源与监听器。 */
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationRequestId !== null) cancelAnimationFrame(animationRequestId);
      animationRequestId = null;

      if (config.cameraControls) {
        canvas.removeEventListener('wheel', onWheel);
        pointerEvents.forEach(([name, handler]) => canvas.removeEventListener(name, handler));
      }

      scene.remove(mesh);
      mesh.dispose?.();
      geometry.dispose();
      material.uniforms.map.value?.dispose?.();
      material.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}

export default createSpriteMatrixBackend;
