/**
 * 触觉足底原始数据：每帧输出60点原始ADC（6列×10行）、16个IMU字节和带帧尾的完整两包。
 * node examples/node/tactile-foot-raw.js --path COM3 --side left
 * node examples/node/tactile-foot-raw.js --mock --side right --frames 3
 * 实机复用 license-env.js 的 SDK 授权配置；标准输出为逐行 JSON，可重定向到文件。
 */
import { readProduct } from '../../src/quick-flow.js';
import { createProductMockDevice } from '../../src/core/mock.js';
import { activateLicenseFromEnv } from './license-env.js';

/** 校验端口、侧别和有限的命令行选项，防止选项拼写错误改变连接目标。 */
function parseArguments(args) {
  const options = { side: 'auto', frames: 0, mock: false };
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--mock') { options.mock = true; continue; }
    if (!['--path', '--side', '--frames'].includes(argument) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`未知参数或缺少参数值：${argument}`);
    }
    options[argument.slice(2)] = args[++i];
  }
  options.frames = Number(options.frames);
  if (!Number.isSafeInteger(options.frames) || options.frames < 0) throw new Error('--frames 必须为非负整数。');
  if (!['left', 'right', 'auto'].includes(options.side)) throw new Error('--side 请选择 left、right 或 auto。');
  if (options.mock && options.side === 'auto') throw new Error('模拟数据请通过 --side left 或 right 明确指定脚侧。');
  return options;
}

/** 原始数组直接转换为 JSON 数组，不重排、不标定，也不解读 IMU 浮点数。 */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.mock) await activateLicenseFromEnv();
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  let count = 0;
  const onData = frame => {
    process.stdout.write(JSON.stringify({ product: frame.product, side: frame.side,
      packetType: frame.packetType, timestamp: frame.timestamp, rows: frame.rows, cols: frame.cols,
      pressure: Array.from(frame.pressure), imuRaw: Array.from(frame.imu.raw),
      rawPackets: frame.rawPackets.map(packet => Array.from(packet)) }) + '\n');
    count += 1;
    if (options.frames && count >= options.frames) finish();
  };
  const onError = error => {
    console.error(`[${error.code ?? 'ERROR'}] ${error.message}`);
    process.exitCode = 1;
    finish();
  };
  const device = options.mock ? createProductMockDevice({ product: 'foot', side: options.side })
    : await readProduct({ product: 'foot', ...(options.path ? { path: options.path } : {}),
      side: options.side, reconnect: false, onData, onError });
  if (options.mock) { device.onError(onError); device.onData(onData); }
  process.once('SIGINT', finish);
  process.once('SIGTERM', finish);
  try { await completed; }
  finally {
    process.removeListener('SIGINT', finish);
    process.removeListener('SIGTERM', finish);
    await device.close();
  }
}

main().catch(error => { console.error(`[${error.code ?? 'ERROR'}] ${error.message}`); process.exitCode = 1; });
