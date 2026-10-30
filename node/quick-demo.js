/**
 * 产品端到端演示：Node 取数，web/quick-start.html 负责查看、采集控制与下载。
 *   node node/quick-demo.js --mock --port 19999
 *   node node/quick-demo.js --path COM3 --side left --port 19999
 *   node node/quick-demo.js --product hand --path COM4 --port 19999
 * 另开终端运行 node start.mjs，再按终端显示的端口访问 web/quick-start.html。
 */
import { connectGlove, connectHandPad } from './serial.js';
import { serveDevice } from './quick-server.js';
import { createProductMockDevice } from '../core/mock.js';
import { activateLicenseFromEnv } from './license-env.js';

/** 严格解析有限的命令行参数，防止拼写错误悄悄选中错误的设备或产品。 */
function parseArguments(args) {
  const options = { product: 'handGloveFullPacket', side: 'left', port: 19999, mock: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--mock') { options.mock = true; continue; }
    if (!['--path', '--side', '--port', '--product'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`未知参数或缺少参数值：${arg}`);
    }
    options[arg.slice(2)] = args[++i];
  }
  options.port = Number(options.port);
  if (!['handGloveFullPacket', 'hand'].includes(options.product) || !['left', 'right'].includes(options.side)) {
    throw new Error('product 只支持 handGloveFullPacket 或 hand；side 只支持 left 或 right。');
  }
  if (!options.mock && !options.path) throw new Error('真实设备请明确指定 --path COM3；无硬件请使用 --mock。');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port 必须为 1–65535。');
  return options;
}

/** 命令行进程同时持有设备和 WS 服务，退出时按顺序释放两类资源。 */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.mock) await activateLicenseFromEnv();
  const device = options.mock ? createProductMockDevice({ product: options.product, ...(options.product === 'hand' ? {} : { side: options.side }) })
    : options.product === 'hand' ? await connectHandPad({ path: options.path })
      : await connectGlove({ path: options.path, side: options.side });
  let relay;
  try { relay = await serveDevice(device, { port: options.port }); }
  catch (error) { await device.close(); throw error; }
  console.log(`产品：${options.product}${options.product === 'hand' ? '' : ` (${options.side})`}，数据源：${device.info.source}`);
  console.log(`WS：${relay.url}；录制下载：${relay.httpUrl}/recordings/<id>.csv`);
  console.log('另开终端运行 node start.mjs，然后打开 http://localhost:5178/web/quick-start.html；输入上面的端口。');
  console.log('录制由 Node 保存到当前目录 .shroom-recordings，网页断开不会停止录制；Ctrl+C 会写完并退出。');
  let stopping = false;
  /** 先等待入库队列排空并关闭服务，再释放串口；重复退出信号不重复收尾。 */
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try { await relay.close(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { await device.close(); }
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => { console.error(`[${error.code ?? 'ERROR'}] ${error.message}`); process.exitCode = 1; });
