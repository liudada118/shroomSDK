import { readProduct } from 'shroom-sdk/quick-flow';
import {
  Shroom, scanProductPorts, connectGlove, connectProduct,
  type DetectedProductPort, type ProductPortScanEntry, type ProductPortScanResult,
  type ProductPortScanSettings, type NodeFullPacketGloveOptions,
} from 'shroom-sdk/node';
import { connectGlove as connectWebGlove } from 'shroom-sdk';

/** 类型示例不执行硬件操作；验证扫描与五步入口保持同一份公开契约。 */
async function discoveryTypes() {
  const signal = new AbortController().signal;
  const settings: ProductPortScanSettings = { paths: ['COM3'], timeoutMs: 1200, signal };
  const result: ProductPortScanResult = await scanProductPorts({ product: 'glove', side: 'left', ...settings });
  const byAlias = await Shroom.scanProductPorts({ product: 'handGloveSegmented' });
  await scanProductPorts();
  const device: DetectedProductPort | undefined = result.devices[0];
  const port: ProductPortScanEntry | undefined = byAlias.ports[0];
  if (device) {
    const side: 'left' | 'right' = device.side;
    const id: 'handGloveSegmented' = device.product;
    const type: number = device.packetType;
    const serialNumber: string | undefined = device.serialNumber;
    void [side, id, type, serialNumber];
  }
  if (port?.status === 'error') void port.error?.code;
  const auto = await readProduct({ product: 'glove', onData: frame => void frame.packetType });
  const limited = await connectGlove({ side: 'auto', scan: settings });
  const noOptions = await connectGlove();
  const explicit = await connectProduct({ product: 'handGloveSegmented', path: 'COM3', side: 'right', scan: {} });
  const packetType: number | undefined = explicit.info.packetType;
  const fullOptions: NodeFullPacketGloveOptions = { side: 'left', path: 'COM4' };
  const full = await connectProduct({ product: 'handGloveFullPacket', ...fullOptions });
  void packetType;
  await Promise.all([auto.close(), limited.close(), noOptions.close(), explicit.close(), full.close()]);
}
void discoveryTypes;

// @ts-expect-error 当前扫描仅支持分包手套，不能声称识别鞋垫。
void scanProductPorts({ product: 'insole' });
// @ts-expect-error 公共扫描的 side 是筛选值；省略即可扫描任意侧，不接收 auto。
void scanProductPorts({ side: 'auto' });
// @ts-expect-error 扫描窗口必须为数字。
void scanProductPorts({ timeoutMs: '1200' });
// @ts-expect-error 五步 WS 接收不能带入 Node 串口探测配置。
void readProduct({ url: 'ws://localhost:19999', scan: {} });
// @ts-expect-error 浏览器直连仍需明确手侧，不继承 Node 自动发现。
void connectWebGlove({ side: 'auto' });
// @ts-expect-error 浏览器不接受 Node 扫描参数。
void connectWebGlove({ side: 'left', scan: {} });
// @ts-expect-error 兼容整包协议仍要求显式手侧。
void readProduct({ product: 'handGloveFullPacket' });
// @ts-expect-error 兼容整包协议不能使用自动手侧。
void readProduct({ product: 'handGloveFullPacket', side: 'auto' });
// @ts-expect-error 兼容整包协议不能扫描成默认分包设备。
void connectProduct({ product: 'handGloveFullPacket', side: 'left', scan: {} });
