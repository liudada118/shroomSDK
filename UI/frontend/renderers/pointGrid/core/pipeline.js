/**
 * pipeline.js - 点阵渲染器的纯数据管线
 *
 * 把原先内嵌在场景组件 sitRenew() 里的数据变换提取为纯函数。
 * 提取的意义有两层：
 *
 * 1. 可测：管线是纯的，参数化前后可以逐帧逐点比对，
 *    不需要启动 Electron 或创建 WebGL 上下文。
 * 2. 可复用：55 个场景组件用的是同一套变换，差别只在参数，
 *    提取之后它们才可能收敛成一个渲染器。
 *
 * 变换顺序与原实现逐字对应，不做任何"顺手优化"——
 * 一致性验证通过之前，任何改动都会污染基准。
 */

// 扩展名必须写全 —— 这一层要能被裸 Node import（`scripts/smoke-core.mjs`
// 守着这条性质），Node 的 ESM 解析不做补全。搬进包之前这两条写的是
// `'../../assets/util/util'` 和 `'./params'`，靠 Vite 补的扩展名。
import { addSide, gaussBlur_1, interpSmall } from '../../../core/frameMath.js';
import { deriveGridSize } from './params.js';

/**
 * 为 3D 点阵生成稳定的平面坐标。
 * 有物理点位表时保持传感器真实形状；没有时回退为规则矩阵。
 *
 * @param {object} options 坐标生成参数。
 * @param {number} options.amountX 行方向点数。
 * @param {number} options.amountY 列方向点数。
 * @param {number} options.separation 规则矩阵点间距。
 * @param {Array<[number, number]>} [options.points] row-major 物理点位表。
 * @returns {Float32Array} 每点三个分量的基础坐标，Y 固定为 0。
 */
export function buildPointGridBasePositions({
  amountX,
  amountY,
  separation,
  points = null,
}) {
  const total = amountX * amountY;
  const result = new Float32Array(total * 3);
  const validPoints = Array.isArray(points)
    && points.length === total
    && points.every((point) => (
      Array.isArray(point)
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1]))
    ));

  if (validPoints) {
    const xs = points.map((point) => Number(point[0]));
    const ys = points.map((point) => Number(point[1]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const longestSide = Math.max(width, height);
    if (longestSide > 0) {
      const targetExtent = Math.max(amountX - 1, amountY - 1, 1) * separation;
      const scale = targetExtent / longestSide;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      points.forEach((point, index) => {
        const offset = index * 3;
        result[offset] = (Number(point[0]) - centerX) * scale;
        result[offset + 1] = 0;
        result[offset + 2] = -(Number(point[1]) - centerY) * scale;
      });
      return result;
    }
  }

  let index = 0;
  for (let row = 0; row < amountX; row += 1) {
    for (let col = 0; col < amountY; col += 1) {
      const offset = index * 3;
      result[offset] = row * separation - ((amountX - 1) * separation) / 2;
      result[offset + 1] = 0;
      result[offset + 2] = col * separation - ((amountY - 1) * separation) / 2;
      index += 1;
    }
  }
  return result;
}

/**
 * 执行点阵数据管线。
 *
 * 对应原 matCol.jsx / carCol.jsx 中 sitRenew() 的前三步：
 *   interpSmall -> addSide -> gaussBlur_1
 *
 * 注意宽高的对应关系沿用原实现：width 取 num2，height 取 num1。
 * 这个对应看起来别扭，但三次调用是自洽的，改了会破坏渲染结果。
 *
 * @param {number[]} source 原始通道数据，长度应为 num1 * num2。
 * @param {{ num1: number, num2: number, interp: number, order: number }} channel 通道参数。
 * @param {number} blurRadius 高斯模糊半径，对应旧代码的 valueg1。
 * @param {number[]} [output] 可复用的输出缓冲区，省去每帧分配。
 * @returns {number[]} 长度为 amountX * amountY 的模糊后网格。
 */
export function runPointGridPipeline(source, channel, blurRadius, output) {
  const { amountX, amountY, total } = deriveGridSize(channel);

  const interpolated = interpSmall(
    source,
    channel.num2,
    channel.num1,
    channel.interp,
    channel.interp,
  );

  const padded = addSide(
    interpolated,
    channel.num2 * channel.interp,
    channel.num1 * channel.interp,
    channel.order,
    channel.order,
  );

  const target = output && output.length === total ? output : new Array(total).fill(0);

  gaussBlur_1(padded, target, amountY, amountX, blurRadius);

  return target;
}

/**
 * 创建带缓冲区复用的管线执行器。
 *
 * 原实现每帧都会新建 interpSmall / addSide 的中间数组，在 30-100Hz
 * 下产生可观的 GC 压力。这里至少把最终输出缓冲区固定下来；
 * 中间数组的复用要改 `../frameMath.js` 里那两个函数的签名（它们现在都返回
 * 新数组），留待管线验证通过后再做。
 *
 * @param {{ num1: number, num2: number, interp: number, order: number }} channel 通道参数。
 * @returns {(source: number[], blurRadius: number) => number[]} 管线执行器。
 */
export function createPointGridPipeline(channel) {
  const { total } = deriveGridSize(channel);
  const buffer = new Array(total).fill(0);
  return (source, blurRadius) => runPointGridPipeline(source, channel, blurRadius, buffer);
}
