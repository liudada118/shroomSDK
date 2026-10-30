/**
 * 把一帧数据画到 canvas 上。三种画法：
 *
 *   dots（默认）—— Shroom 桌面端那种点阵：一片带透视的小圆点，没受力的地方是蓝色底噪，
 *                  受力的地方顶起来并变绿变黄变红。做法和桌面端 three/hand.jsx 一样，
 *                  只是那边用 THREE.Points，这里用 canvas 自己投影，省掉 Three.js 依赖。
 *   heat       —— 每个传感点一个圆斑叠加成一片，看整体压力分布。
 *   grid       —— 一个点一个方格，看原始矩阵、调试尺寸用。
 *
 * 用法：
 *   const heatmap = createHeatmap(document.querySelector('#view'))
 *   device.onFrame(frame => heatmap.render(frame))
 */
import { getColormap } from '../core/colormap.js';

/** heat 模式下圆斑在离屏缓冲里占多少像素。够画出渐变就行，再大只是徒增开销 */
const CELL_PX = 10;

// —— 点阵参数，一一对应桌面端 three/hand.jsx 里的那几个 ——
/**
 * sitInterp：每两个传感点之间插几格。点阵比传感器矩阵密得多，靠的就是它。
 * 桌面端用 4，但它是 GPU 画的、点可以小到亚像素；这里在 canvas 里画，
 * 太密了点与点之间就没缝、糊成一张纸，看不出「点阵」，所以退一档到 3。
 */
const INTERP = 3;
/** sitOrder：四周补几圈边，免得最外圈的点被高斯截掉一半 */
const ORDER = 3;
/** carValueg：高斯模糊半径 */
const BLUR = 2;
/** carValuel：时间柔化系数，越大画面越黏、越不容易抖 */
const SMOOTH = 3;
/** 满量程的点能顶多高，按点阵宽度的比例算 */
const RELIEF = 0.55;
/** 相机离点阵中心多远，按点阵宽度的比例算 */
const DIST = 2.1;
/** 视野 45°，再乘一点放大系数让点阵基本占满画面 */
const FOV = Math.PI / 4;
const ZOOM = 1.4;
/** 地面网格线的间隔（格）和往外延伸的倍数 */
const FLOOR_STEP = INTERP * 4;
const FLOOR_SPAN = 1.25;

/**
 * @param {HTMLCanvasElement|string} target canvas 元素或选择器
 * @param {object} [options]
 * @param {string}          [options.mode]     'dots' | 'heat' | 'grid'，默认 'dots'
 * @param {string|Function} [options.colormap] 'jet' | 'jetWhite' | 'grey' 或自定义函数，默认 'jet'
 * @param {boolean} [options.smooth]  是否平滑，默认 true；grid 模式下 false 就是马赛克风格
 * @param {number}  [options.gain]    显示增益，默认 1；信号弱的时候调大能看清
 * @param {number}  [options.dotSize] 点/圆斑的大小倍数，默认 1
 * @param {number}  [options.relief]  点阵起伏高度倍数，默认 1；给 0 就是平的俯视点阵
 * @param {number}  [options.tilt]    俯视角（度），默认 70。越大越像正俯视、方阵看着越方
 * @param {boolean} [options.flipY]   数据第一行画在近处（画面下方），默认 true。
 *                                    按下面却是上面鼓起来，就把它设成 false
 * @param {string}  [options.background] heat / grid 模式的底色，默认透明（露出 canvas 自己的底色）。
 *                                    Shroom 桌面端热力图铺的是 '#666'，想一模一样就传它
 * @returns {object} 提供 render/resize/setOptions/clear；绘图增益只影响显示，不改帧数据。
 */
export function createHeatmap(target, options = {}) {
  const canvas = typeof target === 'string' ? document.querySelector(target) : target;
  if (!canvas || canvas.tagName !== 'CANVAS') {
    throw new Error('createHeatmap 需要一个 <canvas> 元素');
  }

  const ctx = canvas.getContext('2d');
  let colormap = getColormap(options.colormap);
  let mode = normalizeMode(options.mode);
  let smooth = options.smooth !== false;
  let gain = options.gain ?? 1;
  let dotSize = options.dotSize ?? 1;
  let relief = options.relief ?? 1;
  // 0° 是完全平视（什么也看不见），90° 是正俯视（没有透视），两头都留出余量。
  // 默认 70°：方阵看过去基本还是方的，同时还留得住起伏
  let tilt = Math.min(89, Math.max(5, options.tilt ?? 70));
  let flipY = options.flipY !== false;
  let background = options.background ?? null;

  /** 未指定或未知模式统一回退为点阵，使切换入口与默认配置一致。 */
  function normalizeMode(m) {
    return m === 'grid' ? 'grid' : m === 'heat' ? 'heat' : 'dots';
  }

  // 离屏缓冲：heat / grid 用，尺寸跟着数据的 rows/cols 走，变了才重建
  let buffer = null;
  let bufferCtx = null;
  let image = null; // grid 模式用
  let bufRows = 0;
  let bufCols = 0;

  // 颜色查找表：把 0~255 的强度直接映射成颜色，省得每像素调一次 colormap
  let lut = null;

  function buildLut() {
    lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i += 1) {
      const [r, g, b] = colormap(i / 255);
      lut[i * 3] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
  }
  buildLut();

  // ---------------------------------------------------------------- 点阵

  // 点阵的三块缓冲：散点 → 模糊 → 时间柔化。尺寸变了才重建，柔化那块要保留跨帧的值
  let latRows = 0;
  let latCols = 0;
  let bigW = 0;
  let bigH = 0;
  let scatter = null;
  let blurred = null;
  let tmp = null;
  let held = null;
  // 高斯核。二维高斯是可分离的，拆成横竖两趟，结果和桌面端那个双重循环版本一样，但快得多
  let kernel = null;
  let kernelR = 0;
  // 画布像素缓冲：所有东西（背景、地面线、点）都直接写进这块，最后一次 putImageData
  let screen = null;
  let screenW = 0;
  let screenH = 0;

  /** 构建并归一化高斯核，避免平滑本身改变整体亮度。 */
  function buildKernel() {
    kernelR = Math.ceil(BLUR * 2.57);
    kernel = new Float32Array(kernelR * 2 + 1);
    let sum = 0;
    for (let i = -kernelR; i <= kernelR; i += 1) {
      const w = Math.exp(-(i * i) / (2 * BLUR * BLUR));
      kernel[i + kernelR] = w;
      sum += w;
    }
    for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  }
  buildKernel();

  /** 矩阵尺寸改变时才重建点阵缓冲，同时清空不再匹配形状的跨帧柔化值。 */
  function ensureLattice(rows, cols) {
    if (latRows === rows && latCols === cols) return;
    latRows = rows;
    latCols = cols;
    bigW = cols * INTERP + ORDER * 2;
    bigH = rows * INTERP + ORDER * 2;
    const n = bigW * bigH;
    scatter = new Float32Array(n);
    blurred = new Float32Array(n);
    tmp = new Float32Array(n);
    held = new Float32Array(n);
  }

  function ensureScreen() {
    if (screen && screenW === canvas.width && screenH === canvas.height) return;
    screenW = canvas.width;
    screenH = canvas.height;
    screen = ctx.createImageData(screenW, screenH);
  }

  /**
   * 散点：把每个传感点甩到大格子中间那一格，其余留空。
   * 桌面端的 interp() 就是这么干的——它不做插值，空隙全靠后面的高斯摊开。
   * 乘 INTERP² 是为了让摊开之后的整体亮度和原来一致（脉冲阵列卷高斯的能量守恒）。
   */
  function fillScatter(values, rows, cols) {
    scatter.fill(0);
    const half = INTERP >> 1;
    const amp = INTERP * INTERP;
    for (let y = 0; y < rows; y += 1) {
      // flipY：数据第一行画在靠近视点的那一边（画面下方）。
      // 按了下面却是上面鼓起来，就是这里前后反了，把 flipY 关掉即可
      const sy = flipY ? rows - 1 - y : y;
      const by = ORDER + sy * INTERP + half;
      for (let x = 0; x < cols; x += 1) {
        let v = values[y * cols + x] * gain;
        if (v > 1) v = 1;
        else if (v < 0) v = 0;
        scatter[by * bigW + ORDER + x * INTERP + half] = v * amp;
      }
    }
  }

  /** 可分离高斯，边缘按最近的一格补（和桌面端 gaussBlur_1 的 clamp 一致） */
  function blur() {
    for (let y = 0; y < bigH; y += 1) {
      const row = y * bigW;
      for (let x = 0; x < bigW; x += 1) {
        let v = 0;
        for (let k = -kernelR; k <= kernelR; k += 1) {
          let sx = x + k;
          if (sx < 0) sx = 0;
          else if (sx >= bigW) sx = bigW - 1;
          v += scatter[row + sx] * kernel[k + kernelR];
        }
        tmp[row + x] = v;
      }
    }
    for (let y = 0; y < bigH; y += 1) {
      for (let x = 0; x < bigW; x += 1) {
        let v = 0;
        for (let k = -kernelR; k <= kernelR; k += 1) {
          let sy = y + k;
          if (sy < 0) sy = 0;
          else if (sy >= bigH) sy = bigH - 1;
          v += tmp[sy * bigW + x] * kernel[k + kernelR];
        }
        blurred[y * bigW + x] = v;
      }
    }
  }

  function putPixel(d, x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= screenW || y >= screenH) return;
    const p = (y * screenW + x) * 4;
    d[p] = r;
    d[p + 1] = g;
    d[p + 2] = b;
    d[p + 3] = 255;
  }

  /** 画直线用的最朴素做法：按较长的那条边等分推进。地面网格线才几十条，够用了 */
  function drawLine(d, x0, y0, x1, y1, r, g, b) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
    if (steps <= 0 || steps > 8192) return; // 退化的线和投影炸掉的线都直接跳过
    const stepX = dx / steps;
    const stepY = dy / steps;
    let x = x0;
    let y = y0;
    for (let i = 0; i <= steps; i += 1) {
      putPixel(d, x | 0, y | 0, r, g, b);
      x += stepX;
      y += stepY;
    }
  }

  /**
   * 点阵主体。整条链路和桌面端一样：
   * 散点 → 高斯摊开 → 逐点时间柔化 → 按值定高度、按值取颜色，然后透视投影画出来。
   * 关键是**每个格点都画**，包括没受力的——它们是 jet 的最低档，正好是纯蓝，
   * 那片蓝色底噪就是桌面端点阵的样子。
   */
  function drawLattice(values, rows, cols) {
    ensureLattice(rows, cols);
    ensureScreen();
    fillScatter(values, rows, cols);
    blur();

    // 背景：和页面里 canvas 的底色对上，免得边上有一圈色差
    const d = screen.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 13;
      d[i + 1] = 17;
      d[i + 2] = 23;
      d[i + 3] = 255;
    }

    // 相机：架在点阵斜上方看向中心。这些量都按点阵宽度取比例，换多大的矩阵构图都一样。
    // tilt 就是俯视角：越接近 90° 越像正俯视、方阵看着越方，但起伏也越看不出来
    const span = Math.max(bigW, bigH);
    const len = span * DIST;
    const rad = (tilt * Math.PI) / 180;
    const camH = len * Math.sin(rad);
    const camD = len * Math.cos(rad);
    const upY = camD / len;
    const upZ = -camH / len;
    // 焦距按画布短边算，画布不是正方形的时候点阵也不会被切掉
    const focal = (Math.min(screenW, screenH) / 2 / Math.tan(FOV / 2)) * ZOOM;
    const cx = screenW / 2;
    const cy = screenH / 2;
    // 起伏高度就是实打实的世界坐标高度，不随视角补偿。
    // （试过按 1/cos(tilt) 补：视角一陡补偿系数就爆掉，峰顶被顶得比点阵还宽，
    //   整片脱离底面飞到画面上方去了。视角陡本来就该看不出起伏，这是实话。）
    const height = span * RELIEF * relief;

    // 投影一个世界坐标点。返回 null 表示它在相机后面，不用画
    function project(wx, wy, wz) {
      const py = wy - camH;
      const pz = wz - camD;
      const ez = -(py * camH + pz * camD) / len;
      if (ez < 1) return null;
      const ey = py * upY + pz * upZ;
      const inv = focal / ez;
      return { x: cx + wx * inv, y: cy - ey * inv, s: inv };
    }

    // 地面网格：铺在 y=0 上、比点阵大一圈，露在点阵外面的那部分就是画面里的地平网格。
    // 只是个参照物，线要稀、要暗——太密太亮的话，近处那几十条横线会连成一片纹理，
    // 反过来盖过点阵本身（这就是「下面出现很多条纹」的来源）
    const reach = (span * FLOOR_SPAN) / 2;
    for (let t = -reach; t <= reach + 0.001; t += FLOOR_STEP) {
      const a = project(t, 0, -reach);
      const b = project(t, 0, reach);
      if (a && b) drawLine(d, a.x, a.y, b.x, b.y, 24, 30, 40);
      const c = project(-reach, 0, t);
      const e = project(reach, 0, t);
      if (c && e) drawLine(d, c.x, c.y, e.x, e.y, 24, 30, 40);
    }

    // 逐点画。iy 从 0 开始就是从最远的一排往近处画，近处的点自然盖住远处的，
    // 不用另外排序（画家算法）
    const offX = (bigW - 1) / 2;
    const offZ = (bigH - 1) / 2;
    for (let iy = 0; iy < bigH; iy += 1) {
      // 点的大小按**这一排地面**的深度算，和点自己的高度无关。
      // 要是跟着高度走，点一被顶起来就离相机近一点、算出来的大小在 1px 和 2px 之间来回翻，
      // 上万个点各翻各的，看过去就是满屏闪。钉死在每排一个值，画面立刻就稳了
      const rowEz = -(-camH * camH + (iy - offZ - camD) * camD) / len;
      let size = Math.round((focal / rowEz) * 0.5 * dotSize);
      if (size < 2) size = 2; // 1px 的点太容易被亚像素抖动甩来甩去
      else if (size > 8) size = 8;

      for (let ix = 0; ix < bigW; ix += 1) {
        const l = iy * bigW + ix;
        // 时间柔化：新值只往里掺一部分，画面就不会随噪声一帧一跳
        held[l] += (blurred[l] - held[l]) / SMOOTH;
        let v = held[l];
        if (v > 1) v = 1;
        else if (v < 0) v = 0;

        const p = project(ix - offX, v * height, iy - offZ);
        if (!p) continue;

        const c = ((v * 255) | 0) * 3;
        const r = lut[c];
        const g = lut[c + 1];
        const b = lut[c + 2];
        const x0 = (p.x - size / 2) | 0;
        const y0 = (p.y - size / 2) | 0;
        for (let yy = 0; yy < size; yy += 1) {
          for (let xx = 0; xx < size; xx += 1) putPixel(d, x0 + xx, y0 + yy, r, g, b);
        }
      }
    }

    ctx.putImageData(screen, 0, 0);
  }

  // ------------------------------------------------------------ heat / grid

  // 圆斑图章：中心不透明、边缘透明的黑色圆。画的时候用 globalAlpha 控制强弱，
  // 所以这张图只需要做一次，尺寸变了才重做。
  let stamp = null;
  let stampRadius = 0;

  function ensureStamp(radius) {
    if (stamp && stampRadius === radius) return;
    stampRadius = radius;
    stamp = document.createElement('canvas');
    stamp.width = radius * 2;
    stamp.height = radius * 2;
    const sc = stamp.getContext('2d');
    const grad = sc.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, radius * 2, radius * 2);
  }

  function ensureBuffer(rows, cols) {
    const w = mode === 'heat' ? cols * CELL_PX : cols;
    const h = mode === 'heat' ? rows * CELL_PX : rows;
    if (buffer && bufRows === rows && bufCols === cols && buffer.width === w) return;
    buffer = document.createElement('canvas');
    buffer.width = w;
    buffer.height = h;
    // heat 模式每帧都要读回像素，标上这个标志浏览器才不会走 GPU 往返的慢路径
    bufferCtx = buffer.getContext('2d', { willReadFrequently: mode === 'heat' });
    image = mode === 'grid' ? bufferCtx.createImageData(cols, rows) : null;
    bufRows = rows;
    bufCols = cols;
  }

  /** grid：一个点一个像素 */
  function drawGrid(values, rows, cols) {
    const data = image.data;
    for (let i = 0; i < rows * cols; i += 1) {
      let v = values[i] * gain;
      if (v > 1) v = 1;
      const idx = (v * 255) | 0;
      const p = i * 4;
      data[p] = lut[idx * 3];
      data[p + 1] = lut[idx * 3 + 1];
      data[p + 2] = lut[idx * 3 + 2];
      data[p + 3] = 255;
    }
    bufferCtx.putImageData(image, 0, 0);
  }

  /** heat：每个点盖一个圆斑，叠加出来的**透明度**就是这一片的压力强度，最后按透明度上色 */
  function drawHeat(values, rows, cols) {
    const radius = Math.max(2, Math.round(CELL_PX * 1.1 * dotSize));
    ensureStamp(radius);

    const w = buffer.width;
    const h = buffer.height;
    bufferCtx.clearRect(0, 0, w, h);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let v = values[y * cols + x] * gain;
        if (v > 1) v = 1;
        if (v <= 0.01) continue; // 太弱的点不画，省一大半开销
        bufferCtx.globalAlpha = v;
        bufferCtx.drawImage(stamp, (x + 0.5) * CELL_PX - radius, (y + 0.5) * CELL_PX - radius);
      }
    }
    bufferCtx.globalAlpha = 1;

    // 按叠加出来的 alpha 上色；alpha 原样保留，所以弱的地方自然淡出
    const img = bufferCtx.getImageData(0, 0, w, h);
    const dd = img.data;
    for (let i = 0; i < dd.length; i += 4) {
      const a = dd[i + 3];
      if (a === 0) continue;
      const p = a * 3;
      dd[i] = lut[p];
      dd[i + 1] = lut[p + 1];
      dd[i + 2] = lut[p + 2];
    }
    bufferCtx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- 公共

  /** 按容器大小和屏幕像素比调整画布分辨率，避免高分屏发虚 */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const nw = Math.max(1, Math.round(w * dpr));
    const nh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width = nw;
      canvas.height = nh;
    }
  }

  function draw(frame) {
    const { values, rows, cols } = frame;
    resize();

    if (mode === 'dots') {
      drawLattice(values, rows, cols);
      return;
    }

    ensureBuffer(rows, cols);
    if (mode === 'heat') drawHeat(values, rows, cols);
    else drawGrid(values, rows, cols);

    ctx.imageSmoothingEnabled = smooth;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 圆斑是带透明度的，底下垫一层色才有桌面端那种「灰底上浮着一片热区」的观感
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  }

  // 数据来得比屏幕刷得快：串口 1000000 波特下一秒能来上百帧，屏幕才 60 帧。
  // 每来一帧就重画一次，多画的那些一帧都显示不出来，白烧 CPU；更麻烦的是时间柔化
  // 也跟着跑上百次，数据一快一慢柔化力度就跟着变，画面就不稳。
  // 所以只记下最新的一帧，一个刷新周期画一次——柔化节奏固定，画面也就稳了。
  let pending = null;
  let rafId = 0;

  /** @param {object} frame decodeFrame 出来的 Frame */
  function render(frame) {
    if (!frame || !frame.values) return;
    pending = frame;
    // 没有 rAF 的环境（Node 里跑测试、离屏渲染）就直接画，行为不变
    if (typeof requestAnimationFrame !== 'function') {
      pending = null;
      draw(frame);
      return;
    }
    if (rafId) return; // 已经排上队了，等它那次把最新的一帧画出来
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const next = pending;
      pending = null;
      if (next) draw(next);
    });
  }

  return {
    render,
    resize,
    /** 运行中换画法 / 配色 / 平滑 / 增益 */
    setOptions(next = {}) {
      if (next.mode !== undefined) {
        const wanted = normalizeMode(next.mode);
        if (wanted !== mode) {
          mode = wanted;
          buffer = null; // 几种模式缓冲尺寸不一样，强制重建
          if (held) held.fill(0); // 换回点阵时别把上一次的余温带进来
        }
      }
      if (next.colormap !== undefined) {
        colormap = getColormap(next.colormap);
        buildLut();
      }
      if (next.smooth !== undefined) smooth = next.smooth !== false;
      if (next.gain !== undefined) gain = next.gain;
      if (next.dotSize !== undefined) dotSize = next.dotSize;
      if (next.relief !== undefined) relief = next.relief;
      if (next.tilt !== undefined) tilt = Math.min(89, Math.max(5, next.tilt));
      if (next.flipY !== undefined) flipY = next.flipY !== false;
      if (next.background !== undefined) background = next.background || null;
    },
    clear() {
      // 断开之后别让排着队的那一帧再画出来，否则清完画面又闪一下
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafId = 0;
      pending = null;
      if (held) held.fill(0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    get canvas() {
      return canvas;
    },
  };
}
