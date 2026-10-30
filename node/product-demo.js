/**
 * 产品取数命令行示例：先激活，再读取整包手套或手部检测垫。
 * 产品函数内置波特率、帧长和线序；手套的左右手仍必须按实物选择。
 */
import { Shroom } from './index.js';
import { activateLicenseFromEnv } from './license-env.js';

const [product, ...args] = process.argv.slice(2);

/** 打印产品帧摘要；完整矩阵和 IMU 原始字节在回调 data 中。 */
function printProductData(data) {
  console.log({
    product: data.product, side: data.side, sequence: data.sequence,
    rows: data.rows, cols: data.cols, max: data.max, area: data.area,
    ...(data.fingers ? {
      fingerAdc: Object.fromEntries(Object.entries(data.fingers).map(([name, finger]) => [name, Array.from(finger.raw)])),
      pulpAdc: Object.fromEntries(Object.entries(data.fingers).map(([name, finger]) => [name, finger.pulp.raw[0]])),
      palmAdc: data.palm.matrix,
    } : {}),
  });
}

/** 连接前错误由 Promise 抛出，连接后的错误由 onError 报告。 */
async function main() {
  let device;
  const callbacks = {
    onData: printProductData,
    onError: (error) => {
      console.error(`[${error.code}] ${error.message}\n${error.suggestion}`);
      if (error.code !== 'CALLBACK_FAILED') process.exitCode = 1;
    },
  };
  if (product === 'glove' && ['left', 'right'].includes(args[0])) {
    await activateLicenseFromEnv();
    device = await Shroom.connectGlove({ ...callbacks, side: args[0], path: args[1] });
  } else if (product === 'hand-pad') {
    await activateLicenseFromEnv();
    device = await Shroom.connectHandPad({ ...callbacks, path: args[0] });
  } else {
    console.log('用法：\n  node node/product-demo.js glove left COM3\n  node node/product-demo.js glove right COM4\n  node node/product-demo.js hand-pad COM5');
    return;
  }
  console.log(`已连接：${device.info.label}。Ctrl+C 关闭。`);
  process.once('SIGINT', async () => {
    try { await device.close(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { process.exit(process.exitCode ?? 0); }
  });
}

main().catch((error) => {
  console.error(`[${error.code ?? 'ERROR'}] ${error.message}`);
  if (error.suggestion) console.error(error.suggestion);
  process.exitCode = 1;
});
