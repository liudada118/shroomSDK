/**
 * frameMath.js - 渲染器要用的纯帧函数
 *
 * 这个文件是**拆包时新建的，但每个函数体都是逐字搬过来的**，不是重写：
 *
 * | 函数 | 原位置 | 原行数 | 哪一轮搬的 |
 * | :--- | :--- | ---: | :--- |
 * | `findMax` | `client/src/assets/util/util.js` | 7 | 一（numMatrix） |
 * | `jet` | `client/src/assets/util/util.js` | 20 | 一（numMatrix） |
 * | `press` | `client/src/assets/util/line.js:257-308` | 51 | 一（numMatrix） |
 * | `interpSmall` | `client/src/assets/util/util.js` | 12 | 二（pointGrid） |
 * | `addSide` | `client/src/assets/util/util.js` | 33 | 二（pointGrid） |
 * | `gaussBlur_1` | `client/src/assets/util/util.js` | 17 | 二（pointGrid） |
 * | `jetRound` | `client/src/assets/util/util.js:488-494` | 7 | 三（canvas2d） |
 * | `rotate90CW` | `client/src/assets/util/util.js:898-915` | 18 | 三（canvas2d） |
 * | `gaussBlur_2` + `boxBlur_2` + `boxesForGauss` | `client/src/assets/util/util.js` | 44 | 三（canvas2d） |
 *
 * ## 为什么要新建这一个文件，而不是把 util.js 整份搬过来
 *
 * `util.js` 是 1,440 行、顶层就读 `localStorage`（`initValue` 常量）、内部导入
 * 不写扩展名的 legacy 模块。它一进包，`core/` 就同时失去「零依赖」与「裸 Node
 * 可加载」两条性质 —— 而这两条正是 `scripts/smoke-core.mjs` 守着的东西。
 *
 * 渲染器真正需要的只有上面这几个函数，且都是纯的。所以把它们搬进来，
 * `util.js` / `line.js` 在原路径**re-export 本文件**，那 80 个
 * `from '../../assets/util/util'` 的消费文件一行都不用改 —— 与 `jetRgb` 搬进
 * `jetLadder.js` 时用的是同一套做法（见 `jetLadder.js` 头部）。
 *
 * `util.js` 侧配了一条身份断言（`util.jet.test.js`），锁的是「两边是同一个函数
 * 对象」而不是「行为相同」：没有它，将来有人图省事在 `util.js` 里再写一份函数体，
 * 不会有任何测试失败。
 *
 * ## 唯一的行为改动
 *
 * `press` 的 `type !== 'row'` 那支原来有一句 `console.log(colArr)`，**每帧都打**。
 * 它是调试残留（同一份原实现里还有一句 `console.log('分压')`，搬 `sprite3d.js`
 * 时已经摘掉了）。这里也摘掉：60Hz 刷控制台会拖慢开发者工具，而一个要发出去的
 * 包更不该往消费者的控制台里写东西。返回值一个字节都没变。
 */

import { jetRgb } from './jetLadder.js';

/**
 * 求数组最大值。
 *
 * 逐字搬自 `util.js`。注意 `max` 初值是 **0 而不是 -Infinity** —— 全负数组返回 0。
 * 压力数据非负，所以两者等价；但这是原行为，别"顺手修正"。
 *
 * @param {number[]} arr 数值数组。
 * @returns {number} 最大值；空数组给 0。
 */
export function findMax(arr) {
  let max = 0;
  arr.forEach((item) => {
    max = max > item ? max : item;
  });
  return max;
}

/**
 * jet 配色的整数三元组出口。
 *
 * 逐字搬自 `util.js`。取整用的是 `parseInt(255 * r + '')` 而不是 `Math.round`
 * —— 撞上科学计数法会出错（`parseInt('7.1e-12') === 7`），`util.jet.test.js`
 * 里有一条断言把这个 bug 锁住了。**这是 18 处老配色现在的观感，别改。**
 * 需要正确取整的新通路走 `colormaps.js` 的 `sampleColormapRgb`。
 *
 * @param {number} min 值域下界。
 * @param {number} max 值域上界。
 * @param {number} x 取样值，超出 [min, max] 会被夹取。
 * @returns {number[]} `[r, g, b]`，各分量 0-255 的整数。
 */
export function jet(min, max, x) {
  const { r, g, b } = jetRgb(min, max, x);
  var rgb = new Array();
  rgb[0] = parseInt(255 * r + '');
  rgb[1] = parseInt(255 * g + '');
  rgb[2] = parseInt(255 * b + '');
  return rgb;
}

/**
 * 分压重分配。
 *
 * 逐字搬自 `line.js:257-308`（只摘掉那句每帧的 `console.log`，见文件头）。
 * 只有 `Fast1024sit` 这一条预设启用它（`pressureRedistribution.enabled`）。
 *
 * 语义是「把每行（或每列）的读数按该行总和与 `value` 的差重新归一」，
 * `value - colArr[i] <= 0 ? 1 : value - colArr[i]` 这个守卫是防除零兼防倒相。
 *
 * @param {number[]} arr 原始帧。
 * @param {number} width 矩阵宽度。
 * @param {number} height 矩阵高度。
 * @param {number} value 分压基准（原实现里的 `valuep`）。
 * @param {number} prop 分压比例（原实现里的 `valueprop`）。
 * @param {'row'|'col'} [type] 沿行还是沿列归一。
 * @returns {number[]} 重分配后的新数组，不改入参。
 */
export function press(arr, width, height, value, prop, type = "row") {
  let wsPointData = [...arr];

  if (type == "row") {
    let colArr = [];
    for (let i = 0; i < height; i++) {
      let total = 0;
      for (let j = 0; j < width; j++) {
        total += wsPointData[i * width + j];
      }
      colArr.push(total);
    }
    // //////okok
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        wsPointData[i * width + j] = parseInt(
          (wsPointData[i * width + j] /
            (value - colArr[i] <= 0 ? 1 : value - colArr[i])) *
          1000 * prop
        );
      }
    }
  } else {
    let colArr = [];
    for (let i = 0; i < height; i++) {
      let total = 0;
      for (let j = 0; j < width; j++) {
        total += wsPointData[j * height + i];
      }
      colArr.push(total);
    }
    // //////okok

    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        wsPointData[j * height + i] = parseInt(
          (wsPointData[j * height + i] /
            (value - colArr[i] <= 0 ? 1 : value - colArr[i])) *
          1000 * prop
        );
      }
    }
  }

  return wsPointData;
}

/**
 * 稀疏放大：把小矩阵铺到大矩阵的网格点上，点与点之间留空（填 0）。
 *
 * 逐字搬自 `util.js:237-248`。点阵管线里它跑在 `addSide` 之后、`gaussBlur_1`
 * 之前 —— 先撑开留白，再由高斯模糊把空隙糊成连续的热力面。所以「插值」这个
 * 名字有点误导：**它自己不插值，只做稀疏摆放**，平滑是下一步的事。
 *
 * 两处照抄、别"顺手修正"的行为：
 *
 * 1. **值被乘了 10。** `smallMat[...] * 10` 是写死的放大系数，跟 `decimalScale`
 *    那套没有关系。改它就是改点阵的高度尺度。
 * 2. **纵向步长用的是 `i * interp2`，横向用 `j * interp1`，但行宽算的是
 *    `width * interp1`。** 也就是纵横两个方向的放大倍数可以不同，而行宽只跟
 *    `interp1` 走。调用点传的 `interp1 === interp2 === 2`，所以没人踩到不对称。
 *
 * @param {number[]} smallMat 原矩阵，行优先展开。
 * @param {number} width 原矩阵列数。
 * @param {number} height 原矩阵行数。
 * @param {number} interp1 横向放大倍数。
 * @param {number} interp2 纵向放大倍数。
 * @returns {number[]} 长度 `width * interp1 * height * interp2` 的新数组。
 */
export function interpSmall(smallMat, width, height, interp1, interp2) {

  const bigMat = new Array((width * interp1) * (height * interp2)).fill(0)
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      bigMat[(width * interp1) * i * interp2 + (j * interp1)
      ] = smallMat[i * width + j] * 10
    }
  }
  return bigMat
}

/**
 * 四周镶边：在矩阵左右各加 `wnum` 列、上下各加 `hnum` 行。
 *
 * 逐字搬自 `util.js:305-337`。点阵管线里它排在最前面 —— 高斯模糊在边界处会把
 * 边缘值往外拖，先镶一圈固定值可以让热力面的边收得干净。
 *
 * **`sideNum >= 0 ? sideNum : 1` 这个守卫要照抄。** 它的意思是「负数一律当 1」，
 * 而默认参数是 0，所以不传就镶 0。写成 `sideNum ?? 0` 不等价。
 *
 * 注意左右镶边只在 `j == 0` 与 `j == width - 1` 两支里做 —— `width === 1` 时
 * 走的是第一支，右边不会镶。调用点的宽度都远大于 1，没人踩到。
 *
 * @param {number[]} arr 原矩阵，行优先展开。
 * @param {number} width 原矩阵列数。
 * @param {number} height 原矩阵行数。
 * @param {number} wnum 左右各加几列。
 * @param {number} hnum 上下各加几行。
 * @param {number} [sideNum] 镶边填充值；负数当 1。
 * @returns {number[]} 长度 `(width + 2 * wnum) * (height + 2 * hnum)` 的新数组。
 */
export function addSide(arr, width, height, wnum, hnum, sideNum = 0) {
  let narr = new Array(height);
  let res = [];
  for (let i = 0; i < height; i++) {
    narr[i] = [];

    for (let j = 0; j < width; j++) {
      if (j == 0) {
        narr[i].push(
          ...new Array(wnum).fill(sideNum >= 0 ? sideNum : 1),
          arr[i * width + j]
        );
      } else if (j == width - 1) {
        narr[i].push(
          arr[i * width + j],
          ...new Array(wnum).fill(sideNum >= 0 ? sideNum : 1)
        );
      } else {
        narr[i].push(arr[i * width + j]);
      }
    }
  }
  for (let i = 0; i < height; i++) {
    res.push(...narr[i]);
  }

  return [
    ...new Array(hnum * (width + 2 * wnum)).fill(sideNum >= 0 ? sideNum : 1),
    ...res,
    ...new Array(hnum * (width + 2 * wnum)).fill(sideNum >= 0 ? sideNum : 1),
  ];
}

/**
 * 朴素高斯模糊。**这个函数不是纯的 —— 结果写进 `tcl`，没有返回值。**
 *
 * 逐字搬自 `util.js:371-387`。本文件里其余函数都返回新数组，只有它是原地写出参，
 * 所以单独点一句：调用方要自己准备好 `tcl`（长度 `w * h`）。这是原签名，改成
 * 返回新数组会让 7 个调用点全部要改，不在这一轮的范围里。
 *
 * 复杂度是 O(w · h · rs²)，`rs = ceil(r * 2.57)`。点阵传的 `r` 是 4-8，
 * 矩阵放大后接近 100×100，所以单帧几十万次乘加 —— 它是点阵管线里最贵的一步，
 * 也是 `fps: 10` 这个预设值的由来。**要提速得换成可分离卷积（横竖各一遍，
 * 降到 O(w · h · rs)），那是独立的一件事，会改变浮点舍入。**
 *
 * 盒式的那一族（`gaussBlur_2` / `boxBlur_2` / `boxesForGauss`）在下面 —— 它是
 * 可分离实现，`canvas2d` 后端用它；点阵仍然走本函数，没有切过去。
 *
 * @param {number[]} scl 源矩阵，行优先展开，不被修改。
 * @param {number[]} tcl **出参**，长度须为 `w * h`，结果写在这里。
 * @param {number} w 列数。
 * @param {number} h 行数。
 * @param {number} r 高斯半径。
 * @returns {void}
 */
export function gaussBlur_1(scl, tcl, w, h, r) {
  var rs = Math.ceil(r * 2.57); // significant radius
  for (var i = 0; i < h; i++)
    for (var j = 0; j < w; j++) {
      var val = 0,
        wsum = 0;
      for (var iy = i - rs; iy < i + rs + 1; iy++)
        for (var ix = j - rs; ix < j + rs + 1; ix++) {
          var x = Math.min(w - 1, Math.max(0, ix));
          var y = Math.min(h - 1, Math.max(0, iy));
          var dsq = (ix - j) * (ix - j) + (iy - i) * (iy - i);
          var wght = Math.exp(-dsq / (2 * r * r)) / (Math.PI * 2 * r * r);
          val += scl[y * w + x] * wght;
          wsum += wght;
        }
      tcl[i * w + j] = Math.round(val / wsum);
    }
}

/**
 * jet 配色的**四舍五入**出口。
 *
 * 与上面的 `jet` 是同一条阶梯、不同的收尾，两个都要留着：
 *
 * | | 取整 | `max === min` |
 * | :--- | :--- | :--- |
 * | `jet`（18 处老配色） | `parseInt(255 * r + '')` | `g` 是 `NaN` |
 * | `jetRound`（本函数） | `Math.round(255 * r)` | 返回 `[255, 255, 255]` |
 *
 * 逐字搬自 `util.js:488-494`。`canvas2d` 后端画的每一个数字都走它
 * （原实现写的是 `import { jetRound as jet }`，容易看成走的是上面那个）。
 *
 * @param {number} min 值域下界。
 * @param {number} max 值域上界。
 * @param {number} x 取样值，超出 [min, max] 会被夹取。
 * @returns {number[]} `[r, g, b]`，各分量 0-255 的整数。
 */
export function jetRound(min, max, x) {
  if (x < min) x = min;
  if (x > max) x = max;
  if (max - min === 0) return [255, 255, 255];
  const { r, g, b } = jetRgb(min, max, x);
  return [Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)];
}

/**
 * 顺时针旋转 90°。
 *
 * 逐字搬自 `util.js:898-915`。**参数名是 `(arr, height, width)`，顺序反直觉**，
 * 而且返回矩阵的形状是 `width × height`（行列互换）—— 唯一的调用点
 * （`canvas2d` 后端的 `changeWsData`）传的是 32×32，方阵看不出来。
 * 非方阵调用请自己核对下标，原实现没有非方阵的先例。
 *
 * @param {number[]} arr 原矩阵，行优先展开。
 * @param {number} height 原矩阵行数。
 * @param {number} width 原矩阵列数。
 * @returns {number[]} 旋转后的新数组，长度不变。
 */
export function rotate90CW(arr, height, width) {
  const matrix = Array.from({ length: height }, (_, i) => (
    arr.slice(i * width, i * width + width)
  ));

  const newMatrix = [];
  for (let col = 0; col < width; col++) {
    newMatrix[col] = [];
    for (let row = 0; row < height; row++) {
      newMatrix[col][row] = matrix[height - 1 - row][col];
    }
  }

  return newMatrix.flat();
}

/**
 * 逆时针旋转 90°。
 *
 * 逐字搬自 `util.js:868-896`（原名就叫 `rotate90`，没有方向后缀 —— 这里补上
 * `CCW` 是为了和上面那个 `rotate90CW` 区分，两者**不是**互为反函数的同一份代码，
 * 实现思路和坑都不一样）。唯一的调用点是 `handPoints` 渲染器 `hand0205` 预设的
 * 手形掩码，传的是 32×32。
 *
 * ⚠️ **这份实现只对方阵正确**，两处都是原实现的写法，照抄不改：
 *
 * 1. 拆二维时读的是 `arr[i * height + j]` —— 行跨距用的是 `height` 而不是 `width`。
 * 2. 旋转时两层循环都跑到 `len = matrix.length`（行数），列数 `width` 根本没参与。
 *
 * 非方阵调用会静默给出错位结果。原实现没有非方阵的先例，本轮也没有。
 *
 * @param {number[]} arr 原矩阵，行优先展开。
 * @param {number} height 原矩阵行数。
 * @param {number} width 原矩阵列数（见上：实际未参与旋转，只用于拆二维）。
 * @returns {number[]} 旋转后的新数组。
 */
export function rotate90CCW(arr, height, width) {
  const matrix = [];
  for (let i = 0; i < height; i += 1) {
    matrix[i] = [];
    for (let j = 0; j < width; j += 1) {
      matrix[i].push(arr[i * height + j]);
    }
  }

  const temp = [];
  const len = matrix.length;
  for (let i = 0; i < len; i += 1) {
    for (let j = 0; j < len; j += 1) {
      const k = len - 1 - j;
      if (!temp[k]) temp[k] = [];
      temp[k][i] = matrix[i][j];
    }
  }

  let res = [];
  for (let i = 0; i < temp.length; i += 1) {
    res = res.concat(temp[i]);
  }
  return res;
}

/**
 * 三次盒式模糊逼近高斯所用的三个核宽。
 *
 * 逐字搬自 `util.js`（那里有 7 份一模一样的复制粘贴，其中一份在 `NumWs.jsx`
 * 的组件函数体内 —— 也就是**每次渲染重新定义一遍**）。
 *
 * @param {number} sigma 目标高斯标准差。
 * @param {number} n 盒式遍数，调用点一律传 3。
 * @returns {number[]} n 个核宽。
 */
function boxesForGauss(sigma, n) {
  var wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  var wl = Math.floor(wIdeal);
  if (wl % 2 == 0) wl--;
  var wu = wl + 2;
  var mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  var m = Math.round(mIdeal);
  var sizes = [];
  for (var i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

/**
 * 单遍盒式模糊。**不是纯的** —— 结果写进出参 `tcl`。
 *
 * @param {number[]} scl 源矩阵，行优先展开。
 * @param {number[]} tcl **出参**，结果写在这里。
 * @param {number} w 列数。
 * @param {number} h 行数。
 * @param {number} r 盒半径。
 * @returns {void}
 */
function boxBlur_2(scl, tcl, w, h, r) {
  for (var i = 0; i < h; i++)
    for (var j = 0; j < w; j++) {
      var val = 0;
      for (var iy = i - r; iy < i + r + 1; iy++)
        for (var ix = j - r; ix < j + r + 1; ix++) {
          var x = Math.min(w - 1, Math.max(0, ix));
          var y = Math.min(h - 1, Math.max(0, iy));
          val += scl[y * w + x];
        }
      tcl[i * w + j] = val / ((r + r + 1) * (r + r + 1));
    }
}

/**
 * 三遍盒式模糊逼近高斯。返回新数组，**但会把入参 `scl` 也改掉**。
 *
 * 逐字搬自 `util.js`（`NumWs.jsx:442-449` 那一份）。与 `gaussBlur_1` 的区别
 * 不只是快慢，还有两处会改画面的语义，所以**两个都得留着，不能互相替换**：
 *
 * | | 复杂度 | 输出 | 取整 |
 * | :--- | :--- | :--- | :--- |
 * | `gaussBlur_1` | O(w·h·rs²) | 写出参 `tcl` | `Math.round` |
 * | `gaussBlur_2` | O(w·h·r)×3 | **返回**新数组 | 不取整，留浮点 |
 *
 * ⚠️ **第二遍是 `boxBlur_2(tcl, scl, ...)` —— 入参被当成中间缓冲写了一遍。**
 * 原实现如此，调用点传的都是刚 `map` 出来的临时数组，所以没人踩到。传共享
 * 数组进来会被就地改掉。
 *
 * @param {number[]} scl 源矩阵，行优先展开；**会被修改**。
 * @param {number} w 列数。
 * @param {number} h 行数。
 * @param {number} r 目标高斯标准差。
 * @returns {number[]} 模糊后的新数组，长度 `w * h`。
 */
export function gaussBlur_2(scl, w, h, r) {
  let tcl = [];
  var bxs = boxesForGauss(r, 3);
  boxBlur_2(scl, tcl, w, h, (bxs[0] - 1) / 2);
  boxBlur_2(tcl, scl, w, h, (bxs[1] - 1) / 2);
  boxBlur_2(scl, tcl, w, h, (bxs[2] - 1) / 2);
  return tcl;
}
