/**
 * rainbowLadder.js - 彩虹阶梯表与它的取样出口，全仓唯一一份
 *
 * 与 [jetLadder.js](jetLadder.js) / [greyLadder.js](greyLadder.js) 是同一类文件、
 * 同一个理由：手部点云渲染器（`react/handPoints/`）要用 `jetWhite3`，而它原来长在
 * `client/src/assets/util/util.js` 里 —— 那份文件 1,440 行、顶层就读 `localStorage`、
 * 内部 import 不写扩展名，一进 `core/` 就同时毁掉「零依赖」与「裸 Node 可加载」两条性质。
 *
 * 所以把**阶梯表 + 取样函数**这一对搬进这个零依赖零副作用的文件里，
 * `color.js` 与 `util.js` 在原路径 re-export，消费方一行不改。
 *
 * ## 这条阶梯和 jet 不是一回事
 *
 * `jetRgb` 是**连续**的四段线性插值；这条是**离散查表**，26 级、按 `Math.floor`
 * 落格，而且**倒着取**（值越大越靠表头 = 越红）。两者观感差别很大，别互相替换。
 *
 * ## 关于表尾那 3 个白
 *
 * 表尾 `[255,255,255]` ×3 是刻意的：低压区直接显白（这就是名字里 "White" 的来源），
 * 而不是像 jet 那样显蓝。手套点云的底色因此是白的。
 */

/**
 * 彩虹阶梯表。逐字搬自 `client/src/assets/util/color.js:93-119`，
 * 连同那 4 行注释掉的项一起保留（原样，别"顺手补全"—— 放开就是另一套观感）。
 *
 * 26 级：红→橙→黄→绿→青→蓝（18 级）+ 蓝 ×5 + 白 ×3。
 *
 * @type {number[][]} 每项是 `[r, g, b]`，各分量 0-255 的整数。
 */
export const rainbowTextColorsxy = [
  [255, 0, 0],
  [255, 69, 0],
  [255, 136, 0],
  [255, 170, 0],
  [255, 204, 0],
  [255, 255, 0],
  [204, 255, 0],
  [153, 255, 0],
  [102, 255, 0],
  [51, 255, 0],
  [0, 255, 0],
  [0, 255, 51],
  [0, 255, 102],
  [0, 255, 153],
  [0, 255, 204],
  [0, 255, 255],
  [0, 204, 255],
  [0, 153, 255],
  // ...new Array(1).fill([0, 102, 255]),
  // ...new Array(1).fill([0, 255, 255]),
  // ...new Array(1).fill([0, 204, 255]),
  // ...new Array(1).fill([0, 153, 255]),
  ...new Array(5).fill([0, 102, 255]),
  [255, 255, 255],
  [255, 255, 255],
  [255, 255, 255],
];

/**
 * 彩虹取样。逐字搬自 `util.js:667-676`。
 *
 * 四处必须照抄、别"顺手修正"的行为：
 *
 * 1. **`if (!x)` 而不是 `if (x == null)`** —— `x` 为 `0`（以及 `NaN`）时也走这一支，
 *    返回表的最后一项，也就是**白**。压力为 0 的点因此是白的。这是手套点云现在的观感。
 * 2. **`min` 参数没被用上。** `count` 算的是 `(max - min) * 2 / length`，但下面
 *    `Math.floor(x / count)` 用的是 `x` 而不是 `x - min`。只有 `min === 0` 时两者
 *    才等价 —— 所有调用点传的都是 0，所以没人踩到。
 * 3. **`* 2` 那个系数**：和 `jetgGrey` 的 `(max - min) / length` 差一个 2，
 *    也就是说这条阶梯只用到值域的前一半就走到表尾了，后一半全部夹在最红那级。
 * 4. **索引是 `length - 1 - num` 倒着取。** 值越大取到的颜色越靠表头（越红）。
 *
 * `util.js` 里还有一个 `jetWhite4`，与本函数**逐字相同**（连注释都一样）。
 * 本轮没有一并收敛：它有独立的调用方，合并是单独一件事。已记积压。
 *
 * @param {number} min 值域下界（实际未参与索引计算，见上）。
 * @param {number} max 值域上界。
 * @param {number} x 取样值。
 * @returns {number[]} `[r, g, b]`，各分量 0-255 的整数。**返回的是表里的那个数组本身，
 *   不是副本** —— 调用方不要就地改它（原实现如此，所有调用点都只读）。
 */
export function jetWhite3(min, max, x) {
  if (!x) {
    return rainbowTextColorsxy[rainbowTextColorsxy.length - 1];
  }
  const length = rainbowTextColorsxy.length;
  const count = (max - min) * 2 / length;
  const num = Math.floor(x / count) >= length - 1
    ? length - 1
    : Math.floor(x / count) < 0 ? 0 : Math.floor(x / count);
  return rainbowTextColorsxy[length - 1 - num];
}
