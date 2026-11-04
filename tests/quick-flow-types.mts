import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from 'shroom-sdk/quick-flow';
import { connectProduct as connectNodeProduct, listPorts, type SerialConnectionStatus } from 'shroom-sdk/node';
import { connectProduct as connectWebProduct, type GloveFrame, type HandPadFrame, type HumanBodyFrame, type InsoleFrame, type ProductFrame, type ProductDevice, type NodeProductDevice } from 'shroom-sdk';

async function fiveFunctions() {
  const ports = await listPorts();
  const path: string | undefined = ports[0]?.path;
  void path;
  const glove = await readProduct({ product: 'glove', side: 'left', onData(frame) {
    const data: GloveFrame = frame; void data.fingers;
  } });
  glove.onData(frame => { const data: GloveFrame = frame; void data.imu; });
  const pad = await readProduct({ product: 'pad', reconnect: { intervalMs: 3000, maxAttempts: 3 },
    onStateChange(status) { const state: SerialConnectionStatus = status; void state.attempt; }, onData(frame) {
    const data: HandPadFrame = frame; void data.pressureMatrix;
  } });
  pad.onStateChange(status => { void status.state; });
  const server = await createWS(pad);
  const stream = await readProduct<GloveFrame>({ url: server.url, onData(frame) { void frame.palm; } });
  await startRecording(stream, { label: '抓握' });
  const record = await stopRecording(stream);
  const url: string = downloadRecording(stream, { format: 'jsonl' });
  void [record.id, url];
  await stream.close(); await server.close(); await glove.close();
}
void fiveFunctions;

async function newProducts() {
  const body = await readProduct({ product: 'body', path: 'COM4', onData(frame) {
    const data: HumanBodyFrame = frame;
    const indices: Uint16Array = data.regions.back.sourceIndices;
    void indices;
  } });
  const insole = await connectNodeProduct({ product: 'jqInsole', side: 'right', protocol: '8bit', baudRate: 1500000,
    onData(frame) {
      const data: InsoleFrame = frame;
      if (data.protocol === '12bit') {
        const pressure: Uint16Array = data.pressure;
        void [pressure, data.imu.gyroscope];
      } else {
        const pressure: Uint8Array = data.pressure;
        void [pressure, data.sequence];
      }
    } });
  const webInsole = await connectWebProduct({ product: 'insole', side: 'left', protocol: '12bit' });
  // 常规的公开设备注解也必须接受12位产品，且能够按product/协议收窄。
  const annotated: NodeProductDevice = insole;
  const annotatedWeb: ProductDevice = webInsole;
  annotated.onData(frame => {
    const common: ProductFrame = frame;
    if (frame.product === 'jqInsole' && frame.protocol === '12bit') {
      const pressure: Uint16Array = frame.pressure;
      void [pressure, frame.sensors, common];
    }
  });
  void annotatedWeb;
  await body.close(); await insole.close(); await webInsole.close();
}
void newProducts;

// @ts-expect-error 鞋垫没有可靠脚侧协议字段，不能省略side。
void readProduct({ product: 'insole' });
// @ts-expect-error 人体全身无需side。
void readProduct({ product: 'humanBody', side: 'left' });
// @ts-expect-error 不猜测鞋垫协议。
void readProduct({ product: 'insole', side: 'left', protocol: 'auto' });
// @ts-expect-error 仅接受来源列举的波特率。
void readProduct({ product: 'insole', side: 'left', baudRate: 123 });
// @ts-expect-error WS不能混入设备协议配置。
void readProduct({ url: 'ws://localhost:19999', protocol: '8bit' });

// @ts-expect-error 手套必须明确左右手。
void readProduct({ product: 'glove' });
// @ts-expect-error 手垫不接收手侧。
void readProduct({ product: 'pad', side: 'left' });
// @ts-expect-error Node 入口也拒绝手垫手侧。
void connectNodeProduct({ product: 'hand', side: 'right' });
// @ts-expect-error Web 入口与 Node 采用同一产品参数约束。
void connectWebProduct({ product: 'pad', side: 'left' });
// @ts-expect-error 产品协议参数不能被调用方覆盖。
void readProduct({ product: 'glove', side: 'left', baudRate: 9600 });
// @ts-expect-error 底层统一连接也不能带额外协议参数。
void connectNodeProduct({ product: 'glove', side: 'left', baudRate: 9600 });
// @ts-expect-error WS 与串口配置不可混用。
void readProduct({ product: 'pad', url: 'ws://localhost:19999' });

declare const unselectedProduct: 'glove' | 'pad';
// @ts-expect-error 动态产品尚未收窄，不能绕过手套的 side 要求。
void readProduct({ product: unselectedProduct });
// @ts-expect-error 显式联合泛型也必须保持产品与参数的对应关系。
void readProduct<'glove' | 'pad'>({ product: 'glove' });

// @ts-expect-error Web 产品连接不接受 Node 重连参数。
void connectWebProduct({ product: 'pad', reconnect: true });
// @ts-expect-error WS 入口不能误用串口重连配置。
void readProduct({ url: 'ws://localhost:19999', reconnect: true });
// @ts-expect-error 重连策略只接受规定的字段。
void readProduct({ product: 'pad', reconnect: { retries: 3 } });
