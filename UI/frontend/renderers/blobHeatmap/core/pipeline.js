/**
 * renderers/blobHeatmap/core/pipeline.js - Canvas 2D 斑点热力的帧运算
 *
 * ## ⚠️ 原件的 `generateData` 有 **50 行是死的**
 *
 * `client/src/components/heatmap/canvas.jsx:64-136` 依次算了：
 *
 * ```
 * resData = rotateArrayCounter90Degrees(arr, …)   // 非 carCol 时旋转
 * newArr  = resData.map(a => a > valuef1 ? a : 0) // 下限过滤
 * resArr  = 总和 < valuelInit1 ? new Array(1024).fill(0) : newArr
 * bigArr  = interpSmall(resArr, …)                // 插值
 * bigArrs = addSide(bigArr, …)                    // 补边
 * gaussBlur_1(bigArrs, bigArrg, …, valueg1)       // 高斯模糊
 * ```
 *
 * 然后最后那个铺点循环读的是 **`arr`** —— 原始入参。`resData` / `newArr` /
 * `resArr` / `bigArr` / `bigArrs` / `bigArrg` **一个都没被读过**。
 *
 * 这四个函数都不改入参（`interpSmall` 新建 `bigMat`、`addSide` 新建、
 * `gaussBlur_1` 写第二个参数、`.map` 本来就是拷贝），所以整段是**纯浪费**，
 * 删掉逐像素相同。`pipeline.test.js` 里有一条用例把这件事钉住。
 *
 * 连带的结论要说清楚：**侧栏那四个滑块（`valueg` / `valuel` / `valuef` /
 * `valuelInit`）在这个渲染器上一直是不起作用的** —— 它们只喂给上面那条死链。
 * 搬进包之后仍然不起作用（界面零变化是这一轮的硬约束），但 `sitValue` 照收，
 * 免得宿主的调用点报错。要让它们生效是另一件事，记在积压里。
 */

/**
 * 把一帧铺成带屏幕坐标的点表。
 *
 * ⚠️ **坐标公式照抄，它是错位的。** 原件写的是
 *
 * ```js
 * obj.x = i * canvas.width  / width      // i 走 0..height-1，却除以 width
 * obj.y = j * canvas.height / height     // j 走 0..width-1， 却除以 height
 * ```
 *
 * 行下标配的是宽、列下标配的是高 —— 方阵（32×32，主应用绝大多数情况）看不出来，
 * 但 `carCol` 的 10×9 会既转置又缩放不匀（x 最多到画布的 0.8，y 正好铺满一格
 * 出界）。搬家不改观感，所以逐字保留；要正过来就是换一条公式的事。
 *
 * @param {number[]} values 一帧原始数据。
 * @param {number} width 矩阵宽。
 * @param {number} height 矩阵高。
 * @param {number} canvasWidth 画布宽，像素。
 * @param {number} canvasHeight 画布高，像素。
 * @returns {Array<{x: number, y: number, value: number}>} 点表。
 */
export function buildBlobPoints(values, width, height, canvasWidth, canvasHeight) {
  const points = [];
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      points.push({
        x: (i * canvasWidth) / width,
        y: (j * canvasHeight) / height,
        value: values[i * width + j],
      });
    }
  }
  return points;
}

/**
 * 按透明度把点分桶 —— 同一桶的点共用一次 `globalAlpha`，少设 N 次状态。
 *
 * ⚠️ 桶的键是 `toFixed(2)` 出来的**字符串**，所以最多 101 个桶；`draw()` 里
 * `context.globalAlpha = i` 直接把字符串赋给了一个数字属性（浏览器会转）。
 * 逐字保留 —— 它决定了 alpha 的量化台阶是 0.01，换成不量化会改画面。
 *
 * `Math.min(1, value / max)`：`value` 是 `undefined` 时结果是 `NaN`，
 * `NaN.toFixed(2)` 是 `'NaN'`，`draw()` 里那句 `if (isNaN(i)) continue` 正是
 * 为它准备的。所以缺数据的点会被整桶跳过，不是画成黑的。
 *
 * @param {Array<{x: number, y: number, value: number}>} points 点表。
 * @param {number} max 满值阈值。
 * @returns {Array<{alpha: string, points: Array<object>}>} 按 alpha 分好的桶。
 */
export function groupByAlpha(points, max) {
  const buckets = new Map();
  points.forEach((point) => {
    const alpha = Math.min(1, point.value / max).toFixed(2);
    if (!buckets.has(alpha)) buckets.set(alpha, []);
    buckets.get(alpha).push(point);
  });
  return [...buckets.entries()].map(([alpha, bucket]) => ({ alpha, points: bucket }));
}

/**
 * 侧栏那四个读数。与 `renderers/webglHeatmap/core/pipeline.js` 的同名函数**逐字相同** ——
 * 没有共用一份，是因为两个渲染器的 `core/` 子目录彼此不该有依赖（一个二开者
 * 只装 `blobHeatmap` 时不该被拖上另一条通路）。这条重复是有意的，记在这里。
 *
 * ⚠️ 原件的 `<Heatmap>` **根本没有这几个读数** —— 它只暴露 `bthClickHandle` 与
 * `sitValue` 两个方法，不碰 `props.data`。这里提供出来是为了让它和另外三个
 * 渲染器一样能喂侧栏；宿主不传 `data` 就一行都不执行，画面不变。
 *
 * @param {number[]} values 一帧原始数据。
 * @returns {{meanPres: string, maxPres: number, point: number, totalPres: number}} 读数。
 */
export function frameStats(values) {
  const list = Array.isArray(values) ? values : [];
  const max = list.reduce((acc, item) => (acc > item ? acc : item), 0);
  const point = list.filter((item) => item > 0).length;
  const press = list.reduce((sum, item) => sum + item, 0);
  const mean = press / (point === 0 ? 1 : point);
  return {
    meanPres: mean.toFixed(2),
    maxPres: max,
    point,
    totalPres: press,
  };
}
