/**
 * 终端热力图：把一帧画成带颜色的方块，直接在命令行里看。
 *
 * Node 里没有 canvas，这就是 node 端的「显示图像」。
 * 用的是 24 位真彩色转义序列，Windows Terminal / VS Code 终端都支持。
 */
import { getColormap } from '../core/colormap.js';

/**
 * @param {object} frame 含 rows/cols/values 的矩阵 Frame；values 为相对归一化值
 * @param {object} [options]
 * @param {number} [options.width]    输出多少列，默认 32（会自动降采样）
 * @param {string|Function} [options.colormap] 默认 'jet'
 * @param {number} [options.gain]     显示增益，默认 1
 * @returns {string} 可直接 console.log 的字符串；只影响终端显示，不修改原始帧
 */
export function renderAscii(frame, options = {}) {
  if (!frame || !frame.values) return '';
  const colormap = getColormap(options.colormap);
  const gain = options.gain ?? 1;
  const outCols = Math.min(options.width ?? 32, frame.cols);
  // 终端字符高约为宽的两倍，行数减半才不会被拉长
  const outRows = Math.max(1, Math.round((frame.rows * outCols) / frame.cols / 2));

  const lines = [];
  for (let y = 0; y < outRows; y += 1) {
    let line = '';
    for (let x = 0; x < outCols; x += 1) {
      const sy = Math.min(frame.rows - 1, Math.floor((y * frame.rows) / outRows));
      const sx = Math.min(frame.cols - 1, Math.floor((x * frame.cols) / outCols));
      let v = frame.values[sy * frame.cols + sx] * gain;
      if (v > 1) v = 1;
      const [r, g, b] = colormap(v);
      line += `\x1b[48;2;${r};${g};${b}m  `;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}
