import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from 'shroom-sdk/quick-flow';
import { connectProduct as connectNodeProduct } from 'shroom-sdk/node';
import { connectProduct as connectWebProduct, type GloveFrame, type HandPadFrame } from 'shroom-sdk';

async function fiveFunctions() {
  const glove = await readProduct({ product: 'glove', side: 'left', onData(frame) {
    const data: GloveFrame = frame; void data.fingers;
  } });
  glove.onData(frame => { const data: GloveFrame = frame; void data.imu; });
  const pad = await readProduct({ product: 'pad', onData(frame) {
    const data: HandPadFrame = frame; void data.pressureMatrix;
  } });
  const server = await createWS(pad);
  const stream = await readProduct<GloveFrame>({ url: server.url, onData(frame) { void frame.palm; } });
  await startRecording(stream, { label: '抓握' });
  const record = await stopRecording(stream);
  const url: string = downloadRecording(stream, { format: 'jsonl' });
  void [record.id, url];
  await stream.close(); await server.close(); await glove.close();
}
void fiveFunctions;

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
