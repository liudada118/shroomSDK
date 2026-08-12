/**
 * renderers/handPoints/core/pipeline.js - 手部点云的两条插值实现
 *
 * ## ⚠️ 这里有两个 interp，它们不是同一个函数的两个版本
 *
 * 迁移计划里原本写的是「`147` 变体里那份本地重复的 26 行 `interp` 直接删，用
 * `core/frameMath.js` 的」。**逐行读完三份实现之后这条被推翻了** —— 仓里其实有
 * **三个**同名不同实现的 `interp`：
 *
 * | 出处 | 行为 | 新建目标数组？ | 居中偏移 |
 * | :--- | :--- | :---: | :---: |
 * | `client/src/assets/util/util.js:190` | 稀疏散点，**就地写入调用方的数组** | 否 | 有（半格） |
 * | `core/frameMath.js` 的 `interpSmall` | 稀疏散点 | 是 | 无 |
 * | `hand0205Point147.jsx:32`（本文件的 `interpRamp`） | **双向线性爬坡填满** | 是 | 无 |
 *
 * 第三个是真的在做插值（相邻两点之间填出斜坡），前两个只是把小矩阵的值**撒**到
 * 大矩阵的稀疏格点上、其余留空。拿 `interpSmall` 顶替 `interpRamp` 会让 147 那条
 * 的画面直接变样。所以两份都搬进来了，各自带原实现的坑。
 *
 * 这是本批相对计划文本的一处明说偏差，与批 2 推翻「两份已漂移 935 行」是同一类
 * 处理：先量，再按量出来的事实改计划。
 */

/**
 * 居中稀疏散点插值（`hand0205` 预设走这条）。逐字搬自 `util.js:190-201`。
 *
 * 五条必须照抄的行为：
 *
 * 1. **就地写 `bigMat`，不返回新数组。** 调用方传进来的是一个**跨帧复用**的数组，
 *    而且初值是 `fill(1)` 不是 `fill(0)` —— 本函数只覆盖那些稀疏格点，其余位置
 *    **永远保持 1**。这不是 bug 是现状：那个 1 会一路走到高斯模糊里去。
 * 2. **下标从 1 起、到 `length` 止**（`x/y ∈ [1, Length]`），所以 `smallMat` 的
 *    读取下标是 `Length * (y - 1) + x - 1`。
 * 3. **`* 10`**：所有值都放大十倍，后面所有阈值（`< 50` 等）都是按放大后的量纲写的。
 * 4. **居中偏移** `(Length * num * num) / 2 + num / 2`：往下半行、往右半格。
 *    `num` 为奇数时 `num / 2` 不是整数，下标会变成小数 → 写进数组的是一个字符串键，
 *    **既不影响长度也永远读不到**。原实现只用偶数 `num`（2 和 4），照抄不改。
 * 5. **只对方阵有意义**：行数与列数都用同一个 `Length`。
 *
 * @param {number[]} smallMat 源矩阵，`Length × Length`。
 * @param {number[]} bigMat 目标矩阵，就地写入。
 * @param {number} Length 源矩阵边长。
 * @param {number} num 插值倍数。
 * @returns {void}
 */
export function interpCentered(smallMat, bigMat, Length, num) {
  for (let x = 1; x <= Length; x += 1) {
    for (let y = 1; y <= Length; y += 1) {
      bigMat[
        Length * num * (num * (y - 1))
        + (Length * num * num) / 2
        + num * (x - 1)
        + num / 2
      ] = smallMat[Length * (y - 1) + x - 1] * 10;
    }
  }
}

/**
 * 双向线性爬坡插值（`hand0205_147` 预设走这条）。
 * 逐字搬自 `hand0205Point147.jsx:32-78`，注释掉的三段一并丢弃（它们是被替换掉的
 * 早期写法，留着只会误导）。
 *
 * 两遍：先沿行方向在相邻两列之间填斜坡，再沿列方向在相邻两行之间填斜坡。
 *
 * ⚠️ **第二遍带一个下标不一致的坑，原样保留**：
 *
 * ```js
 * const colValue = bigMat[((i + 1) * interp2) * newWidth + j]      // 判空看这一行
 *   ? bigMat[(((i + 1) * interp2) + 1) * newWidth + j]             // 取值取下一行
 *   : 0;
 * ```
 *
 * 判空看的是下一个源行，取值取的却是它**再下面一行**（也就是上一遍没写过、
 * 大概率是 0 的那行）。结果是列方向的斜坡几乎总是往 0 收 —— 画面上表现为纵向
 * 比横向更「碎」。这是 147 那条现在的观感，不是可以顺手修的笔误：改了画面就变。
 *
 * 另外两条：原实现第一遍里有个 `colValue` 局部**算了从不用**（那一遍只用
 * `rowValue`），它是纯读、删掉逐点等价，所以这里**没搬**；以及末列的 `rowValue`
 * 会读到下一行行首（一维数组无行边界），这个照抄。
 *
 * @param {number[]} smallMat 源矩阵，`width × height`。
 * @param {number} width 源矩阵列数。
 * @param {number} height 源矩阵行数。
 * @param {number} interp1 列方向倍数。
 * @param {number} interp2 行方向倍数。
 * @returns {number[]} 新数组，长度 `width * interp1 * height * interp2`。
 */
export function interpRamp(smallMat, width, height, interp1, interp2) {
  const bigMat = new Array((width * interp1) * (height * interp2)).fill(0);

  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const realValue = smallMat[i * width + j] * 10;
      const rowValue = smallMat[i * width + j + 1] * 10
        ? smallMat[i * width + j + 1] * 10
        : 0;
      bigMat[(width * interp1) * i * interp2 + (j * interp1)] = smallMat[i * width + j] * 10;
      for (let k = 0; k < interp1; k += 1) {
        bigMat[(width * interp1) * (i * interp2) + (j * interp1 + k)] = realValue
          + (rowValue - realValue) * k / interp1;
      }
    }
  }

  const newWidth = width * interp1;

  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < newWidth; j += 1) {
      const realValue = bigMat[i * interp2 * newWidth + j];
      // 见上：判空与取值差一行，原实现如此。
      const colValue = bigMat[((i + 1) * interp2) * newWidth + j]
        ? bigMat[(((i + 1) * interp2) + 1) * newWidth + j]
        : 0;
      for (let k = 0; k < interp2; k += 1) {
        bigMat[newWidth * (i * interp2 + k) + j] = realValue
          + (colValue - realValue) * k / interp2;
      }
    }
  }

  return bigMat;
}

/** `params.interpMode` 的合法取值。 */
export const INTERP_MODES = ['centered', 'ramp'];
