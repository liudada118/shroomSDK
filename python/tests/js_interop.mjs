// 跨语言互通测试的 Node 端：只调用现有 JS SDK 的公开实现，不包含另一份协议逻辑。
import { createInterface } from 'node:readline';
import { connectStream } from '../../src/web/stream.js';
import { serveDevice } from '../../src/node/quick-server.js';
import { createProductMockDevice } from '../../src/core/mock.js';
import { encodeStreamFrame } from '../../src/core/stream-codec.js';
import { createRecordingStore, recordingCsv, recordingJsonl } from '../../src/node/recording.js';

const [mode, ...args] = process.argv.slice(2);
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const stdinLines = createInterface({ input: process.stdin });
const nextLine = () => new Promise((resolve) => stdinLines.once('line', resolve));
const text = async (chunks) => { let out = ''; for await (const chunk of chunks) out += chunk; return out; };

if (mode === 'client') {
  // JS 网页端客户端连接 Python 服务：严格解码每一帧，再完成一次带标签采集与下载。
  const [url, expected, label] = args;
  const { WebSocket } = await import('ws');
  const frames = [];
  const errors = [];
  const stream = await connectStream({ url, WebSocketImpl: WebSocket,
    onData: (frame) => frames.push(encodeStreamFrame(frame)),
    onError: (error) => errors.push({ code: error.code, message: error.message }) });
  print({ event: 'ready', info: stream.info, recording: stream.recording });
  const started = await stream.startRecording({ label });
  print({ event: 'recording', id: started.id });
  const deadline = Date.now() + 15000;
  while (frames.length < Number(expected) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
  const stopped = await stream.stopRecording();
  const list = await stream.listRecordings();
  const download = async (format) => {
    const response = await fetch(stream.getRecordingUrl(stopped.id, { format }));
    return { status: response.status, type: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition'), body: await response.text() };
  };
  const csv = await download('csv');
  const jsonl = await download('jsonl');
  await stream.close();
  print({ event: 'done', frames, errors, started, stopped, list, csv, jsonl });
  process.exit(0);
}

if (mode === 'server') {
  // JS 服务供 Python 客户端连接；收到一行输入后写完记录并退出。
  const [product, side, directory] = args;
  const device = createProductMockDevice(product === 'hand' ? { product } : { product, side });
  const server = await serveDevice(device, { port: 0, recordingsDir: directory });
  print({ url: server.url, httpUrl: server.httpUrl });
  await nextLine();
  await server.close();
  await device.close();
  process.exit(0);
}

if (mode === 'store-write') {
  // 用 JS 录制器写入 Python 编码的帧，供 Python 端重新打开同一目录读取。
  const [directory, label] = args;
  const frames = JSON.parse(await nextLine());
  const store = await createRecordingStore({ directory });
  const started = await store.start({ label, product: frames[0]?.product, side: frames[0]?.side, source: 'interop' });
  for (const frame of frames) store.append(frame);
  const stopped = await store.stop();
  await store.close();
  print({ started, stopped });
  process.exit(0);
}

if (mode === 'store-read') {
  // 用 JS 录制器打开 Python 写入的目录，列出会话并导出指定记录。
  const [directory, id] = args;
  const store = await createRecordingStore({ directory });
  const list = store.list();
  const descriptor = store.download(id);
  const result = { list, jsonl: await text(recordingJsonl(descriptor)), csv: await text(recordingCsv(descriptor)) };
  await store.close();
  print(result);
  process.exit(0);
}

throw new Error(`unknown mode: ${mode}`);
