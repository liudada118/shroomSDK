/**
 * greyLadder.js - 灰度阶梯与它的取样出口，全仓唯一一份
 *
 * 与 [jetLadder.js](jetLadder.js) 是同一类文件、同一个理由：点阵渲染器
 * （`react/pointGrid/`）要用 `jetgGrey`，而它原来长在 `client/src/assets/util/util.js`
 * 里 —— 那份文件 1,440 行、顶层就读 `localStorage`、内部 import 不写扩展名，
 * 一进 `core/` 就同时毁掉「零依赖」与「裸 Node 可加载」两条性质。
 *
 * 所以把**阶梯表 + 取样函数**这一对搬进这个零依赖零副作用的文件里，
 * `util.js` 与 `value.js` 在原路径 re-export，消费方一行不改。
 *
 * ## 关于 `garyColors` 这个名字
 *
 * 是 `grayColors` 的拼写错误，从 2021 年就这么写。**故意不改**：改了原路径的
 * re-export 壳就得写成映射而不是 `export *`，等于给一个纯搬家动作加上一次
 * 重命名的风险。要改名是单独一件事（先加别名、再逐个换、最后删旧名）。
 *
 * ## 关于表里那 10 行注释掉的灰阶
 *
 * 原样保留。这条阶梯现在实际只有 6 级（0 到 85），点阵的灰度底图就是这个观感，
 * 把注释放开就是 16 级 —— 客户看惯的画面会变。别"顺手补全"。
 */

/**
 * 灰度阶梯表。逐字搬自 `client/src/assets/util/value.js`。
 *
 * @type {number[][]} 每项是 `[r, g, b]`，各分量 0-255 的整数。
 */
export const garyColors = [
  [0, 0, 0],
  [17, 17, 17],
  [34, 34, 34],
  [51, 51, 51],
  [68, 68, 68],
  [85, 85, 85],
  // [102, 102, 102],
  // [119, 119, 119],
  // [136, 136, 136],
  // [153, 153, 153],
  // [170, 170, 170],
  // [187, 187, 187],
  // [204, 204, 204],
  // [221, 221, 221],
  // [238, 238, 238],
  // [255, 255, 255],
];

/**
 * 灰度取样。逐字搬自 `util.js:736-745`。
 *
 * 三处必须照抄、别"顺手修正"的行为：
 *
 * 1. **`if (!x)` 而不是 `if (x == null)`** —— `x` 为 `0` 时也走这一支，返回表的
 *    最后一项（最亮的那级灰）。压力为 0 的点因此是亮的，不是黑的。这是点阵
 *    底图现在的观感。
 * 2. **`min` 参数没被用上。** `count` 算的是 `(max - min) / length`，但下面
 *    `Math.floor(x / count)` 用的是 `x` 而不是 `x - min`。只有 `min === 0` 时
 *    两者才等价 —— 所有调用点传的都是 0，所以没人踩到。
 * 3. **索引是 `length - 1 - num` 倒着取。** 值越大取到的灰阶越暗。
 *
 * @param {number} min 值域下界（实际未参与索引计算，见上）。
 * @param {number} max 值域上界。
 * @param {number} x 取样值。
 * @returns {number[]} `[r, g, b]`，各分量 0-255 的整数。
 */
export function jetgGrey(min, max, x) {
  if (!x) {
    return garyColors[garyColors.length - 1]
  }
  const length = garyColors.length;
  const count = (max - min) / length;
  const num = Math.floor(x / count) >= length - 1 ? length - 1 : Math.floor(x / count) < 0 ? 0 : Math.floor(x / count);
  return garyColors[length - 1 - num];
}
