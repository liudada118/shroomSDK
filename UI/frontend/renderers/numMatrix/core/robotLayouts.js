/**
 * renderers/numMatrix/core/robotLayouts.js - 机器人分区布局的三张点位表
 *
 * `Num2Doriginal.jsx:963-1012` 有三段几乎一样的代码：声明六个（或五个）下标
 * 数组，包成 `{ posArr, text, w, h }`，交给 `processRobotParts`。三段之间只有
 * **数据**不同，没有一行逻辑差异。所以这里把它们摊成表，`robot` 布局那条通路
 * 就变成"查表 → 取值 → 拼图"，二开加一款机器人只要往这张表里加一项，或者
 * 直接在 manifest 里描述自己的分区，不必改渲染器。
 *
 * ## 下标是 1 起点
 *
 * 表里的数字是**原始 256 点数据的 1 起点序号**（`genNewArr` 里 `arr[pos - 1]`），
 * 不是数组下标。照抄原实现，别顺手减 1 —— 这些数是照着实物贴片编号抄下来的。
 *
 * ## 顺序有意义
 *
 * 分区在画面上**从左到右**按数组顺序排（`packRobotLayout` 只累加 `offsetX`）。
 * 三款的顺序各不相同（`robotLCF` 没有 back），是原实现里 `Object.entries()`
 * 遍历字面量的插入序 —— 换成数组之后这个次序变成显式的，不再依赖对象键序。
 *
 * ## 每块的 w / h 与 posArr 长度的关系
 *
 * `w * h` 应当等于 `posArr.length`，`packRobotLayout` 按 `w × h` 行优先铺。
 * 但**原实现里有两处对不上**（见 `ROBOT_LAYOUTS` 里的注释），照抄；
 * `packRobotLayout` 对缺的位置补 0、多的位置丢弃，不会越界。
 */

import { packRobotLayout, pickByPositions } from './layouts.js';

/** 分区之间的间距（格子数）。抄自 `Num2Doriginal.jsx:552`。 */
export const ROBOT_LAYOUT_GAP = 2;

/**
 * 三款机器人的分区表。键就是 `matrixName`。
 *
 * ⚠️ 两处 `w * h !== posArr.length`，是原实现的样子，不是这次抄错：
 * - 所有 `handL` / `handR` 标的是 `w:4, h:2`（8 格），`posArr` 也是 8 个 ✅；
 * - 所有 `shoulderL` / `shoulderR` 标的是 `w:4, h:1`（4 格），`posArr` 4 个 ✅；
 * - `robotSY.back` 标 `w:5, h:5`（25 格），`posArr` 25 个 ✅；
 * - `robot1.back` 标 `w:8, h:5`（40 格），`posArr` 40 个 ✅。
 * 实际全都对得上 —— 这条注释留着是因为 `packRobotLayout` 的补 0 分支容易被
 * 当成死码删掉，它守的是二开自定义分区时写错尺寸的情况。
 */
export const ROBOT_LAYOUTS = {
  robotSY: [
    {
      key: 'back',
      text: '脑袋',
      w: 5,
      h: 5,
      posArr: [
        62, 61, 60, 59, 58, 46, 45, 44, 43, 42, 254, 253, 252, 251, 250,
        14, 13, 12, 11, 10, 30, 29, 28, 27, 26,
      ],
    },
    { key: 'handL', text: '左臂', w: 4, h: 2, posArr: [79, 95, 111, 127, 80, 96, 112, 128] },
    { key: 'shoulderL', text: '左肩', w: 4, h: 1, posArr: [9, 25, 41, 57] },
    { key: 'shoulderR', text: '右肩', w: 4, h: 1, posArr: [249, 233, 217, 201] },
    { key: 'handR', text: '右臂', w: 4, h: 2, posArr: [177, 162, 146, 130, 178, 161, 145, 129] },
    {
      key: 'chest',
      text: '前胸',
      w: 8,
      h: 6,
      posArr: [
        51, 35, 19, 3, 243, 227, 211, 195, 52, 36, 20, 4, 244, 228, 212, 196,
        53, 37, 21, 5, 245, 229, 213, 197, 54, 38, 22, 6, 246, 230, 214, 198,
        55, 39, 23, 7, 247, 231, 215, 199, 56, 40, 24, 8, 248, 232, 216, 200,
      ],
    },
  ],

  // 没有 back —— LCF 那款只有胸口那一大块（8×12）加四肢。
  robotLCF: [
    { key: 'handL', text: '左臂', w: 4, h: 2, posArr: [79, 95, 111, 127, 80, 96, 112, 128] },
    { key: 'shoulderL', text: '左肩', w: 4, h: 1, posArr: [15, 31, 47, 63] },
    { key: 'shoulderR', text: '右肩', w: 4, h: 1, posArr: [255, 239, 223, 207] },
    { key: 'handR', text: '右臂', w: 4, h: 2, posArr: [177, 162, 146, 130, 178, 161, 145, 129] },
    {
      key: 'chest',
      text: '前胸',
      w: 8,
      h: 12,
      posArr: [
        51, 35, 19, 3, 243, 227, 211, 195, 52, 36, 20, 4, 244, 228, 212, 196,
        53, 37, 21, 5, 245, 229, 213, 197, 54, 38, 22, 6, 246, 230, 214, 198,
        55, 39, 23, 7, 247, 231, 215, 199, 56, 40, 24, 8, 248, 232, 216, 200,
        57, 41, 25, 9, 249, 233, 217, 201, 58, 42, 26, 10, 250, 234, 218, 202,
        59, 43, 27, 11, 251, 235, 219, 203, 60, 44, 28, 12, 252, 236, 220, 204,
        61, 45, 29, 13, 253, 237, 221, 205, 62, 46, 30, 14, 254, 238, 222, 206,
      ],
    },
  ],

  // 原文件在这张表上方留了一句注释：「修正后的 robot1 索引映射（基于 robot0401
  // 的原始 256 点 16x16 数据）」。back 叫「后背」而不是「脑袋」，且 handL/handR
  // 的前后四个与 robotSY 是**对调**的 —— 都照抄。
  robot1: [
    {
      key: 'back',
      text: '后背',
      w: 8,
      h: 5,
      posArr: [
        58, 42, 26, 10, 250, 234, 218, 202, 59, 43, 27, 11, 251, 235, 219, 203,
        60, 44, 28, 12, 252, 236, 220, 204, 61, 45, 29, 13, 253, 237, 221, 205,
        62, 46, 30, 14, 254, 238, 222, 206,
      ],
    },
    { key: 'handL', text: '左臂', w: 4, h: 2, posArr: [80, 96, 112, 128, 79, 95, 111, 127] },
    { key: 'shoulderL', text: '左肩', w: 4, h: 1, posArr: [57, 41, 25, 9] },
    { key: 'shoulderR', text: '右肩', w: 4, h: 1, posArr: [249, 233, 217, 201] },
    { key: 'handR', text: '右臂', w: 4, h: 2, posArr: [178, 162, 146, 130, 177, 161, 145, 129] },
    {
      key: 'chest',
      text: '前胸',
      w: 8,
      h: 6,
      posArr: [
        195, 211, 227, 243, 3, 19, 35, 51, 196, 212, 228, 244, 4, 20, 36, 52,
        197, 213, 229, 245, 5, 21, 37, 53, 198, 214, 230, 246, 6, 22, 38, 54,
        199, 215, 231, 247, 7, 23, 39, 55, 200, 216, 232, 248, 8, 24, 40, 56,
      ],
    },
  ],
};

/** 有分区表的 `matrixName`。webgl 后端用它判断走不走 robot 通路。 */
export const ROBOT_LAYOUT_NAMES = Object.keys(ROBOT_LAYOUTS);

/**
 * 按名字取分区表。
 *
 * @param {string} name `matrixName` 或自定义键。
 * @returns {Array<object> | null} 分区表，未知名字返回 `null`（调用方回落到规则网格）。
 */
export function getRobotLayout(name) {
  return ROBOT_LAYOUTS[String(name || '')] || null;
}

/**
 * 一帧原始 256 点数据 → 可直接上传的分区纹理。
 *
 * 等价于原实现的 `processRobotParts` 前半段（`Num2Doriginal.jsx:857-871`）：
 * 先 `genNewArr` 按下标表取值，再 `buildRobotLayout` 拼成一张图。后半段
 * （按 layoutW/layoutH 变化重建 WebGL 上下文）是有状态的，留在后端。
 *
 * @param {number[]} frame 原始帧（1 起点下标对应 `frame[pos - 1]`）。
 * @param {Array<object>} parts 分区表，形如 `ROBOT_LAYOUTS.robotSY`。
 * @param {number} [gap=ROBOT_LAYOUT_GAP] 分区间距（格子数）。
 * @returns {{layoutData: Float32Array, maskData: Uint8Array, layoutW: number,
 *   layoutH: number, partDefsWithOffset: Array<object>}} 拼好的布局。
 */
export function buildRobotFrame(frame, parts, gap = ROBOT_LAYOUT_GAP) {
  const partDefs = parts.map((part) => ({
    key: part.key,
    text: part.text,
    w: part.w,
    h: part.h,
    posArr: part.posArr,
    data: pickByPositions(frame, part.posArr),
  }));
  return packRobotLayout(partDefs, gap);
}

export default ROBOT_LAYOUTS;
